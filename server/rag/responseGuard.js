const BINDING_LEVELS = new Set(['statute', 'regulation', 'ministerial_instruction', 'public_policy']);

function toText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeAuthorityLevel(source) {
  const direct = toText(source?.authorityLevel);
  if (direct) return direct.toLowerCase();

  const raw = toText(source?.raw?.authority_level);
  if (raw) return raw.toLowerCase();

  if (source?.sourceType === 'a2aj_case') return 'case_law';
  if (source?.sourceType === 'user_document') return 'reference';
  return '';
}

function extractCitationIds(text) {
  if (!text || typeof text !== 'string') return [];
  const ids = new Set();
  const regex = /\[\s*([PCD]\d+)\s*\]/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    ids.add(String(match[1]).toUpperCase());
  }
  return Array.from(ids);
}

function hasBindingLanguage(text) {
  if (!text || typeof text !== 'string') return false;
  return /\b(must|required|legally required|the law requires|under irpa|under irpr|binding)\b/i.test(text);
}

function hasTemporalLanguage(text) {
  if (!text || typeof text !== 'string') return false;
  return /\b(current|currently|as of today|most recent|latest|in force)\b/i.test(text);
}

function citedSources(citationIds, citationMap) {
  return citationIds
    .map((id) => citationMap?.[id])
    .filter(Boolean);
}

function prependNotice(text, notice) {
  const cleanNotice = toText(notice);
  if (!cleanNotice) return text;
  if (String(text || '').includes(cleanNotice)) return text;
  const trimmed = String(text || '').trim();
  if (!trimmed) return cleanNotice;
  return `${cleanNotice}\n\n${trimmed}`;
}

export function enforceAuthorityGuard({ text, citationMap, retrieval }) {
  const issues = [];
  let guarded = String(text || '').trim();
  const modelText = guarded;

  const profile = retrieval?.profile || {};
  const requiresBinding = profile.requiresBinding !== false;
  const tierABindingCount = Number(
    retrieval?.tiers?.binding?.bindingAuthorityCount
    || retrieval?.tiers?.binding?.count
    || 0
  );

  if (requiresBinding && tierABindingCount === 0) {
    guarded = prependNotice(guarded, 'No binding authority found in indexed sources for this question.');
    issues.push('no_binding_authority_found');
  }

  const citationIds = extractCitationIds(guarded);
  const sources = citedSources(citationIds, citationMap);
  const levels = sources.map((source) => normalizeAuthorityLevel(source)).filter(Boolean);
  const hasBindingCitation = levels.some((level) => BINDING_LEVELS.has(level));

  if (hasBindingLanguage(modelText) && !hasBindingCitation) {
    guarded = prependNotice(
      guarded,
      'Binding legal claims could not be verified from statute/regulation/MI/public policy citations in the retrieved sources.'
    );
    issues.push('binding_claim_without_binding_citation');
  }

  const hasDatedCitation = sources.some((source) => toText(source?.effectiveDate || source?.raw?.effective_date));
  if (hasTemporalLanguage(modelText) && sources.length > 0 && !hasDatedCitation) {
    guarded = prependNotice(
      guarded,
      'Date sensitivity note: retrieved sources did not include effective-date metadata for citation-level recency validation.'
    );
    issues.push('temporal_claim_without_effective_date');
  }

  return { text: guarded, issues };
}
