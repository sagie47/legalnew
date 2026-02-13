import { createHash } from 'node:crypto';
import { canonicalizeForHash, fetchPdiHtml } from './fetch.js';
import { parsePdiHtml } from './parse.js';
import { extractSectionsFromContainer } from './sectionize.js';
import { chunkSections } from './chunk.js';
import { embedChunks } from './embed.js';
import { upsertPineconeVectors } from './upsert.js';

const UNWRAP_QUERY_KEYS = new Set([
  'url',
  'u',
  'target',
  'dest',
  'destination',
  'redirect',
  'redirect_url',
  'redirect_uri',
  'next',
  'continue',
  'return',
  'return_url',
  'link',
  'href',
]);

const TRACKING_QUERY_KEYS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'fbclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  'yclid',
  'igshid',
  'ref',
  'source',
  'campaign',
]);

function toBool(value) {
  if (typeof value === 'boolean') return value;
  return String(value || '').toLowerCase() === 'true';
}

function decodeCandidate(raw, maxDepth = 3) {
  if (typeof raw !== 'string') return '';
  let out = raw.trim();
  for (let i = 0; i < maxDepth; i += 1) {
    let decoded;
    try {
      decoded = decodeURIComponent(out);
    } catch {
      break;
    }
    if (!decoded || decoded === out) break;
    out = decoded.trim();
  }
  return out;
}

function parseAbsoluteUrl(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractNestedUrlCandidate(urlText) {
  const parsedText = parseAbsoluteUrl(urlText);
  if (!parsedText) return null;

  try {
    const parsed = new URL(parsedText);
    for (const [key, value] of parsed.searchParams.entries()) {
      if (!value) continue;
      const lowerKey = key.toLowerCase();
      const shouldUnwrap = UNWRAP_QUERY_KEYS.has(lowerKey) || lowerKey.includes('url');
      if (!shouldUnwrap) continue;

      const decoded = decodeCandidate(value);
      const nested = parseAbsoluteUrl(decoded) || parseAbsoluteUrl(value);
      if (nested) return nested;
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeInputUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  let normalized = parseAbsoluteUrl(trimmed) || parseAbsoluteUrl(decodeCandidate(trimmed));
  if (!normalized) return null;

  // Unwrap wrappers like ...?url=https%3A%2F%2Fwww.canada.ca%2F...
  for (let i = 0; i < 4; i += 1) {
    const nested = extractNestedUrlCandidate(normalized);
    if (!nested || nested === normalized) break;
    normalized = nested;
  }

  return normalized;
}

function dedupeUrlKey(url) {
  const normalized = normalizeInputUrl(url);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();

    if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
      parsed.port = '';
    }

    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';

    const keptParams = [];
    for (const [key, value] of parsed.searchParams.entries()) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith('utm_') || TRACKING_QUERY_KEYS.has(lowerKey)) {
        continue;
      }
      keptParams.push([key, value]);
    }
    keptParams.sort((a, b) => {
      const keyCmp = a[0].localeCompare(b[0]);
      if (keyCmp !== 0) return keyCmp;
      return a[1].localeCompare(b[1]);
    });

    parsed.search = '';
    for (const [key, value] of keptParams) {
      parsed.searchParams.append(key, value);
    }

    return parsed.toString();
  } catch {
    return normalized;
  }
}

function collectUrlCandidates(input, out, depth = 0) {
  if (depth > 8 || input == null) return;

  if (typeof input === 'string') {
    out.push(input);
    return;
  }

  if (Array.isArray(input)) {
    for (const value of input) {
      collectUrlCandidates(value, out, depth + 1);
    }
    return;
  }

  if (typeof input === 'object') {
    for (const value of Object.values(input)) {
      collectUrlCandidates(value, out, depth + 1);
    }
  }
}

export function resolveIngestUrls(payload) {
  if (!payload || typeof payload !== 'object') return [];

  const list = [];
  collectUrlCandidates(payload.url, list);
  collectUrlCandidates(payload.urls, list);

  const deduped = [];
  const seen = new Set();
  list.forEach((url) => {
    const normalized = normalizeInputUrl(url);
    const key = dedupeUrlKey(normalized);
    if (!normalized || !key || seen.has(key)) return;
    seen.add(key);
    deduped.push(normalized);
  });

  return deduped;
}

function shortHash(value) {
  return createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
}

function headingDistribution(sections) {
  const out = {};
  for (const section of sections) {
    const key = section.top_heading || 'Unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function toText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeDate(value) {
  const text = toText(value);
  if (!text) return '';

  const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return '';
}

function detectDocFamily(combined, sourceUrl) {
  const c = String(combined || '').toLowerCase();
  const u = String(sourceUrl || '').toLowerCase();

  if (c.includes('ontario immigrant nominee') || c.includes('oinp') || u.includes('/ontario/')) return 'OINP';
  if (c.includes('bc pnp') || c.includes('bcpnp') || c.includes('british columbia pnp')) return 'BC_PNP';
  if (c.includes('alberta advantage immigration') || c.includes('aaip')) return 'AAIP';
  if (c.includes('noc 2021') || /\bnoc\b/.test(c)) return 'NOC2021';
  if (c.includes('minimum necessary income') || c.includes('lico') || /\bmni\b/.test(c)) return 'LICO_MNI';
  if (c.includes('ministerial instruction') || /\bmi\b/.test(c)) return 'MI';
  if (c.includes('public policy')) return 'PUBLIC_POLICY';
  if (c.includes('visa office') || u.includes('/visa-office-') || u.includes('/visa-office/')) return 'VOI';
  if (c.includes('enforcement manual') || c.includes('removal order') || u.includes('/enforcement/')) return 'ENF';
  if (c.includes('jurisprudential guide') || c.includes('irb guide')) return 'IRB_GUIDE';
  if (/\birpa\b/.test(c)) return 'IRPA';
  if (/\birpr\b/.test(c) || c.includes('sor-2002-227')) return 'IRPR';
  return 'PDI';
}

function authorityFromDocFamily(docFamily) {
  const map = {
    IRPA: 'statute',
    IRPR: 'regulation',
    MI: 'ministerial_instruction',
    PUBLIC_POLICY: 'public_policy',
    PDI: 'policy',
    ENF: 'manual',
    VOI: 'voi',
    OINP: 'provincial_program',
    BC_PNP: 'provincial_program',
    AAIP: 'provincial_program',
    NOC2021: 'reference',
    LICO_MNI: 'reference',
    IRB_GUIDE: 'jurisprudence',
    CASE_LAW: 'case_law',
  };
  return map[docFamily] || 'policy';
}

function jurisdictionFromDocFamily(docFamily) {
  if (docFamily === 'OINP') return 'ontario';
  if (docFamily === 'BC_PNP') return 'bc';
  if (docFamily === 'AAIP') return 'alberta';
  return 'federal';
}

function detectInstrument(combined, sourceUrl, docFamily) {
  const c = String(combined || '').toLowerCase();
  const u = String(sourceUrl || '').toLowerCase();
  const rules = [
    ['TRV', /\btrv\b|temporary resident visa|visitor|super visa/],
    ['ETA', /\beta\b|electronic travel authorization/],
    ['STUDY', /study permit|student/],
    ['WORK', /work permit|foreign workers|lmia|r205|r186/],
    ['PR_ECON', /express entry|economic class|federal skilled|cec|fst|permanent residence.*economic/],
    ['PR_FAMILY', /family sponsorship|spousal|parent sponsorship/],
    ['PR_REFUGEE', /refugee|asylum|protected person/],
    ['INADMISSIBILITY', /inadmissib|criminality|medical inadmissib|security inadmissib/],
    ['MISREP', /misrep|misrepresentation|\ba40\b/],
    ['ENFORCEMENT', /enforcement|removal order|detention|admissibility hearing/],
  ];
  for (const [tag, pattern] of rules) {
    if (pattern.test(c)) return tag;
  }

  if (u.includes('/temporary-residents/')) return 'TRV';
  if (u.includes('/permanent-residence/')) return 'PR_ECON';
  if (u.includes('/enforcement/')) return 'ENFORCEMENT';
  if (u.includes('/refugees/')) return 'PR_REFUGEE';

  const defaults = {
    ENF: 'ENFORCEMENT',
    OINP: 'PR_ECON',
    BC_PNP: 'PR_ECON',
    AAIP: 'PR_ECON',
    NOC2021: 'WORK',
    LICO_MNI: 'PR_FAMILY',
  };
  return defaults[docFamily] || 'WORK';
}

function extractSectionId(text) {
  const raw = String(text || '');
  const token = raw.match(/\b([RA])(\d{1,3})((?:\([a-z0-9]+\))*)/i);
  if (!token) return '';

  const marker = String(token[1] || '').toUpperCase();
  const base = String(token[2] || '');
  const parts = [...String(token[3] || '').matchAll(/\(([a-z0-9]+)\)/gi)].map((match) => String(match[1]).toLowerCase());

  let suffix = '';
  if (parts.length > 0) {
    const [first, ...rest] = parts;
    suffix = /^\d+$/.test(first) ? `_${first}${rest.join('')}` : `${first}${rest.join('')}`;
  }

  if (marker === 'R') return `IRPR_${base}${suffix}`;
  if (marker === 'A') return `IRPA_A${base}${suffix}`;
  return '';
}

function detectProgramStream(combined) {
  const c = String(combined || '').toLowerCase();
  const rules = [
    ['EXPRESS_ENTRY', /express entry/],
    ['PNP', /provincial nominee|oinp|bc pnp|aaip/],
    ['AIP', /atlantic immigration/],
    ['CAREGIVER', /caregiver/],
    ['AGRI_FOOD', /agri[- ]food/],
    ['RURAL', /rural and northern|rural northern/],
    ['OWP', /open work permit|\bowp\b/],
    ['PGWP', /post[- ]graduation|\bpgwp\b/],
    ['SPOUSAL', /spousal sponsorship/],
  ];
  for (const [stream, pattern] of rules) {
    if (pattern.test(c)) return stream;
  }
  return '';
}

function extractNocCode(text) {
  const match = String(text || '').match(/\bNOC\s*([0-9]{4,5})\b/i);
  return match ? match[1] : '';
}

function extractTeer(text) {
  const match = String(text || '').match(/\bTEER\s*([0-5])\b/i);
  return match ? match[1] : '';
}

function detectTableType(combined) {
  const c = String(combined || '').toLowerCase();
  if (c.includes('minimum necessary income') || /\bmni\b/.test(c)) return 'MNI';
  if (c.includes('low income cut-off') || c.includes('lico')) return 'LICO';
  return '';
}

function buildCanonicalMetadata({ sourceUrl, title, lastUpdated, headingPath, text }) {
  const combined = [title, sourceUrl, ...(Array.isArray(headingPath) ? headingPath : []), String(text || '').slice(0, 200)]
    .filter(Boolean)
    .join(' | ');
  const docFamily = detectDocFamily(combined, sourceUrl);
  const sectionId = extractSectionId(text);
  const programStream = detectProgramStream(combined);
  const nocCode = extractNocCode(text);
  const teer = extractTeer(text);
  const tableType = detectTableType(combined);
  const effectiveDate = normalizeDate(lastUpdated);

  return {
    authority_level: authorityFromDocFamily(docFamily),
    doc_family: docFamily,
    instrument: detectInstrument(combined, sourceUrl, docFamily),
    jurisdiction: jurisdictionFromDocFamily(docFamily),
    ...(effectiveDate ? { effective_date: effectiveDate } : {}),
    ...(sectionId ? { section_id: sectionId } : {}),
    ...(programStream ? { program_stream: programStream } : {}),
    ...(nocCode ? { noc_code: nocCode } : {}),
    ...(teer ? { teer } : {}),
    ...(tableType ? { table_type: tableType } : {}),
  };
}

function buildMetadata({ sourceUrl, title, lastUpdated, chunk, chunkId }) {
  const headingPath = Array.isArray(chunk.heading_path) && chunk.heading_path.length > 0
    ? [...chunk.heading_path]
    : [title || 'Untitled PDI'];

  const topHeading = headingPath[0] || title || 'Untitled PDI';
  headingPath[0] = topHeading;
  const canonical = buildCanonicalMetadata({
    sourceUrl,
    title,
    lastUpdated,
    headingPath,
    text: chunk.text,
  });

  return sanitizeMetadata({
    source_type: 'ircc_pdi_html',
    source_url: sourceUrl,
    title,
    last_updated: lastUpdated || undefined,
    heading_path: headingPath,
    top_heading: topHeading,
    anchor: chunk.anchor || undefined,
    section_index: chunk.section_index,
    chunk_index: chunk.chunk_index,
    chunk_id: chunkId,
    est_tokens: typeof chunk.est_tokens === 'number' ? chunk.est_tokens : Math.ceil(String(chunk.text || '').length / 4),
    text: chunk.text,
    ...canonical,
  });
}

function sanitizeMetadata(metadata) {
  const out = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (value === null || typeof value === 'undefined') {
      continue;
    }
    const valueType = typeof value;
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.filter((item) => typeof item === 'string');
    }
  }
  return out;
}

function namespaceOrDefault(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value || process.env.PINECONE_NAMESPACE || 'ircc';
}

export async function ingestPdiUrls({ urls, namespace, dryRun = false } = {}) {
  const targetNamespace = namespaceOrDefault(namespace);
  const uniqueUrls = Array.isArray(urls) ? resolveIngestUrls({ urls }) : [];
  const seenSourceKeys = new Set();

  const result = {
    status: 'ok',
    ingested: 0,
    skipped: 0,
    errors: [],
    stats: {
      totalSections: 0,
      totalChunks: 0,
    },
  };

  for (const inputUrl of uniqueUrls) {
    try {
      const inputKey = dedupeUrlKey(inputUrl) || inputUrl;
      if (seenSourceKeys.has(inputKey)) {
        result.skipped += 1;
        console.log(`[PDI ingest] skipped duplicate input URL: ${inputUrl}`);
        continue;
      }

      const fetched = await fetchPdiHtml(inputUrl);
      const sourceUrl = canonicalizeForHash(fetched.sourceUrl || inputUrl);
      const sourceKey = dedupeUrlKey(sourceUrl) || sourceUrl;
      if (seenSourceKeys.has(sourceKey)) {
        result.skipped += 1;
        console.log(`[PDI ingest] skipped duplicate source URL: ${sourceUrl}`);
        continue;
      }
      seenSourceKeys.add(inputKey);
      seenSourceKeys.add(sourceKey);
      const docHash = shortHash(sourceUrl);

      console.log(`[PDI ingest] fetched OK: ${sourceUrl}`);

      const { $, $container, title, lastUpdated } = parsePdiHtml(fetched.html);
      const sections = extractSectionsFromContainer($, $container, { title });
      const chunks = chunkSections(sections);

      result.stats.totalSections += sections.length;
      result.stats.totalChunks += chunks.length;

      console.log(
        `[PDI ingest] parsed: title="${title}" sections=${sections.length} chunks=${chunks.length} lastUpdated=${lastUpdated || 'null'}`
      );
      console.log(`[PDI ingest] top headings: ${JSON.stringify(headingDistribution(sections))}`);

      if (sections.length === 0 || chunks.length === 0) {
        result.skipped += 1;
        result.errors.push({
          url: sourceUrl,
          stage: 'extract',
          message: 'No sections/chunks extracted from page',
        });
        continue;
      }

      if (toBool(dryRun)) {
        result.ingested += 1;
        continue;
      }

      const { vectors, errors: embedErrors, embeddedCount } = await embedChunks(chunks);
      if (embedErrors.length > 0) {
        embedErrors.forEach((err) => {
          result.errors.push({
            url: sourceUrl,
            ...err,
          });
        });
      }

      const records = [];
      for (let i = 0; i < chunks.length; i += 1) {
        const vector = vectors[i];
        if (!Array.isArray(vector)) continue;

        const chunk = chunks[i];
        const chunkId = `pdi|${docHash}|${chunk.section_index}|${chunk.chunk_index}`;
        records.push({
          id: chunkId,
          values: vector,
          metadata: buildMetadata({
            sourceUrl,
            title,
            lastUpdated,
            chunk,
            chunkId,
          }),
        });
      }

      if (records.length === 0) {
        result.skipped += 1;
        result.errors.push({
          url: sourceUrl,
          stage: 'embed',
          message: `Embedding produced no records (embedded ${embeddedCount}/${chunks.length})`,
        });
        continue;
      }

      const upsert = await upsertPineconeVectors(records, targetNamespace);
      if (upsert.errors.length > 0) {
        upsert.errors.forEach((err) => {
          result.errors.push({
            url: sourceUrl,
            ...err,
          });
        });
      }

      if (upsert.upsertedCount > 0) {
        result.ingested += 1;
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      result.skipped += 1;
      result.errors.push({
        url: inputUrl,
        stage: 'url',
        message: error?.message || 'Failed to process URL',
      });
      console.error(`[PDI ingest] failed: ${inputUrl}`, error);
    }
  }

  return result;
}
