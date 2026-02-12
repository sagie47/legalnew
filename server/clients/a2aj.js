function getA2ajBase() {
  return (process.env.A2AJ_API_BASE || 'https://api.a2aj.ca').replace(/\/$/, '');
}

function getTimeoutMs() {
  const n = Number(process.env.A2AJ_TIMEOUT_MS || 15000);
  return Number.isFinite(n) && n > 0 ? n : 15000;
}

function buildHeaders() {
  const apiKey = process.env.A2AJ_API_KEY;
  return {
    Accept: 'application/json',
    ...(apiKey
      ? {
          Authorization: `Bearer ${apiKey}`,
          'X-API-Key': apiKey,
        }
      : {}),
  };
}

function summarizeErrorPayload(payload) {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    return trimmed ? trimmed.slice(0, 300) : 'A2AJ request failed';
  }
  if (!payload || typeof payload !== 'object') {
    return 'A2AJ request failed';
  }
  const msg = payload.message || payload.error || payload.detail || payload.title || payload.reason;
  if (typeof msg === 'string' && msg.trim()) {
    return msg.trim().slice(0, 300);
  }
  return JSON.stringify(payload).slice(0, 300);
}

async function requestA2aj({ path, method = 'GET', params, body }) {
  const base = getA2ajBase();
  const url = new URL(`${base}${path}`);

  if (params && typeof params === 'object') {
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      const s = String(v).trim();
      if (!s) return;
      url.searchParams.set(k, s);
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
  try {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          ...buildHeaders(),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      const reason = error?.cause?.message || error?.message || 'network failure';
      throw new Error(`A2AJ ${method} ${path} failed (network): ${reason}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const msg = summarizeErrorPayload(payload);
      const err = new Error(`A2AJ ${method} ${path} failed (${response.status}): ${msg}`);
      err.status = response.status;
      throw err;
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function pickItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.hits)) return payload.hits;
  if (Array.isArray(payload.documents)) return payload.documents;
  return [];
}

function normalizeParagraphs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.floor(n));
}

function stripHtml(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toSnippet(item) {
  const snippet =
    item?.snippet ||
    item?.excerpt ||
    item?.summary ||
    item?.text ||
    item?.content ||
    '';
  return stripHtml(snippet).slice(0, 1200);
}

function toDatasetCode(courtName) {
  if (typeof courtName !== 'string') return null;
  const raw = courtName.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (/^[A-Z0-9-]{2,20}$/.test(upper)) return upper;

  const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (normalized.includes('federal court of appeal') || normalized === 'fca') return 'FCA';
  if (normalized.includes('federal court') || normalized === 'fc') return 'FC';
  if (normalized.includes('refugee appeal division') || normalized === 'rad') return 'RAD';
  if (normalized.includes('refugee protection division') || normalized === 'rpd') return 'RPD';
  if (normalized.includes('supreme court') || normalized === 'scc') return 'SCC';
  return null;
}

function buildDatasetFilter(courts) {
  if (!Array.isArray(courts)) return '';
  const out = [];
  for (const court of courts) {
    const code = toDatasetCode(court);
    if (code && !out.includes(code)) out.push(code);
  }
  return out.join(',');
}

function parseSearchMethod(value) {
  const method = String(value || '').toUpperCase();
  return method === 'POST' ? 'POST' : 'GET';
}

function parseYear(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const year = Math.floor(n);
  if (year < 1000 || year > 9999) return null;
  return year;
}

function buildYearDateRange(filters = {}) {
  let yearFrom = parseYear(filters.yearFrom);
  let yearTo = parseYear(filters.yearTo);
  if (yearFrom && yearTo && yearFrom > yearTo) {
    [yearFrom, yearTo] = [yearTo, yearFrom];
  }
  return {
    ...(yearFrom ? { start_date: `${yearFrom}-01-01` } : {}),
    ...(yearTo ? { end_date: `${yearTo}-12-31` } : {}),
  };
}

function buildSearchParams({ query, limit, filters }) {
  const dataset = buildDatasetFilter(filters?.courts);
  return {
    query,
    search_type: 'full_text',
    doc_type: 'cases',
    size: limit,
    search_language: 'en',
    sort_results: 'default',
    ...(dataset ? { dataset } : {}),
    ...buildYearDateRange(filters),
  };
}

function getDecisionText(item) {
  const text =
    item?.unofficial_text_en ||
    item?.unofficial_text ||
    item?.full_text_en ||
    item?.full_text ||
    item?.text_en ||
    item?.text ||
    item?.content ||
    '';
  return stripHtml(text);
}

function toPositiveInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function isLikelyCitation(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  if (/^https?:\/\//i.test(v)) return false;
  return /\b\d{4}\s+[A-Z]{2,12}\s+\d+\b/.test(v);
}

function getCitationCandidates(source) {
  const candidates = [
    source?.neutralCitation,
    source?.id,
    source?.raw?.citation_en,
    source?.raw?.citation,
    source?.raw?.citation_fr,
  ];

  const out = [];
  for (const value of candidates) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || !isLikelyCitation(trimmed) || out.includes(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}

function buildQueryTerms(query) {
  const stop = new Set([
    'what', 'when', 'where', 'which', 'with', 'that', 'this', 'from', 'about', 'would', 'could',
    'should', 'there', 'their', 'have', 'has', 'had', 'into', 'than', 'then', 'they', 'them',
    'outcome', 'explain', 'case', 'law', 'please', 'under', 'over', 'after', 'before', 'between',
  ]);
  return String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !stop.has(w))
    .slice(0, 8);
}

function snippetWindow(text, start, maxChars) {
  if (!text) return '';
  const safeStart = Math.max(0, Math.min(start, Math.max(0, text.length - 1)));
  const begin = Math.max(0, safeStart - Math.floor(maxChars * 0.3));
  const end = Math.min(text.length, begin + maxChars);
  return text.slice(begin, end).trim();
}

function pickDecisionExcerpt({ text, query, maxChars, fallback }) {
  if (!text) return (fallback || '').slice(0, maxChars);
  const lower = text.toLowerCase();

  const outcomeMarkers = [
    'appeal is allowed',
    'appeal allowed',
    'appeal is dismissed',
    'appeal dismissed',
    'application is allowed',
    'application allowed',
    'application is dismissed',
    'application dismissed',
    'is set aside',
    'disposition',
    'held:',
    'conclusion',
  ];
  for (const marker of outcomeMarkers) {
    const idx = lower.indexOf(marker);
    if (idx >= 0) {
      return snippetWindow(text, idx, maxChars);
    }
  }

  const terms = buildQueryTerms(query);
  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx >= 0) {
      return snippetWindow(text, idx, maxChars);
    }
  }

  return text.slice(0, maxChars).trim();
}

function mergeDecisionDetail(source, item, query) {
  const detailText = getDecisionText(item);
  const maxChars = toPositiveInt(process.env.A2AJ_DECISION_SNIPPET_CHARS, 1600, 500, 4000);
  const snippet = pickDecisionExcerpt({
    text: detailText,
    query,
    maxChars,
    fallback: source?.snippet || '',
  });

  return {
    ...source,
    title: item?.name_en || item?.name || source?.title,
    court: item?.dataset || source?.court,
    date: item?.document_date_en || item?.document_date_fr || source?.date,
    neutralCitation: item?.citation_en || item?.citation || source?.neutralCitation,
    url: item?.url_en || item?.url || source?.url,
    snippet: snippet || source?.snippet || '',
    raw: source?.raw,
  };
}

export async function a2ajSearchDecisions({ query, limit = 4, filters = {} }) {
  const q = typeof query === 'string' ? query.trim() : '';
  if (!q) return [];

  const safeLimit = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(50, Math.floor(Number(limit))))
    : 4;
  const params = buildSearchParams({
    query: q,
    limit: safeLimit,
    filters,
  });

  const customPath = typeof process.env.A2AJ_DECISIONS_SEARCH_PATH === 'string'
    ? process.env.A2AJ_DECISIONS_SEARCH_PATH.trim()
    : '';
  const customMethod = parseSearchMethod(process.env.A2AJ_DECISIONS_SEARCH_METHOD);

  const attempts = [
    ...(customPath
      ? [{
          method: customMethod,
          path: customPath.startsWith('/') ? customPath : `/${customPath}`,
          ...(customMethod === 'POST' ? { body: params } : { params }),
        }]
      : []),
    { method: 'GET', path: '/search', params },
  ];

  const errors = [];
  let lastErr = null;
  for (const attempt of attempts) {
    try {
      const payload = await requestA2aj(attempt);
      return pickItems(payload);
    } catch (error) {
      errors.push(`${attempt.method} ${attempt.path}: ${error?.message || 'request failed'}`);
      if (error?.status !== 405) {
        lastErr = error;
      }
    }
  }

  if (lastErr || errors.length > 0) {
    throw new Error(`A2AJ decision search failed. Attempts: ${errors.slice(0, 6).join(' | ')}`);
  }
  return [];
}

export async function a2ajGetDecision({ id }) {
  if (!id) return null;
  const citation = String(id).trim();
  if (!citation) return null;

  const params = {
    citation,
    doc_type: 'cases',
    output_language: 'en',
  };

  const attempts = [
    { method: 'GET', path: '/fetch', params },
  ];

  let lastErr = null;
  for (const attempt of attempts) {
    try {
      return await requestA2aj(attempt);
    } catch (error) {
      lastErr = error;
    }
  }
  if (lastErr) {
    throw lastErr;
  }
  return null;
}

export async function a2ajEnrichCaseSources({ sources, query }) {
  if (!Array.isArray(sources) || sources.length === 0) return Array.isArray(sources) ? sources : [];
  const maxFetch = toPositiveInt(process.env.A2AJ_FETCH_DETAILS_TOP_K, 3, 0, 10);
  if (maxFetch <= 0) return sources;

  const out = [...sources];
  for (let i = 0; i < out.length && i < maxFetch; i += 1) {
    const source = out[i];
    const candidates = getCitationCandidates(source);
    if (candidates.length === 0) continue;

    let detailItem = null;
    for (const citation of candidates) {
      try {
        const payload = await a2ajGetDecision({ id: citation });
        const items = pickItems(payload);
        if (items.length > 0) {
          detailItem = items[0];
          break;
        }
      } catch {
        // Non-fatal: retain search-only snippet for this case.
      }
    }

    if (detailItem) {
      out[i] = mergeDecisionDetail(source, detailItem, query);
    }
  }

  return out;
}

export function a2ajToCaseSources(results) {
  if (!Array.isArray(results)) return [];
  return results
    .map((item) => {
      const id =
        item?.id ||
        item?.citation_en ||
        item?.citation_fr ||
        item?.citation ||
        item?.decision_id ||
        item?.document_id ||
        item?.uuid ||
        item?.slug ||
        item?.url_en ||
        item?.url;
      const title =
        item?.name_en ||
        item?.name ||
        item?.name_fr ||
        item?.title ||
        item?.case_name ||
        item?.caseName;
      const snippet = toSnippet(item);
      if (!title && !snippet) return null;

      return {
        sourceType: 'a2aj_case',
        id: id ? String(id) : `a2aj-${Math.random().toString(36).slice(2, 10)}`,
        title: String(title || 'Case law source'),
        court: item?.court || item?.tribunal || item?.jurisdiction || item?.dataset,
        date: item?.document_date_en || item?.document_date_fr || item?.date || item?.decision_date || item?.published_at || item?.year,
        neutralCitation: item?.citation_en || item?.citation || item?.neutral_citation || item?.neutralCitation || item?.citation_fr,
        url: item?.url_en || item?.url || item?.source_url || item?.sourceUrl || item?.link || item?.href || item?.url_fr,
        paragraphs: normalizeParagraphs(item?.paragraphs || item?.paragraph_numbers || item?.paras),
        snippet,
        score: Number(item?.score || item?.rank || 0) || undefined,
        raw: item,
      };
    })
    .filter(Boolean);
}
