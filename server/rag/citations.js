function toText(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed;
}

function toOptionalText(value) {
  const text = toText(value);
  return text || undefined;
}

function toSourceType(referenceId, rawSourceType) {
  const sourceType = toText(rawSourceType);
  if (sourceType) return sourceType;
  if (referenceId.startsWith('D')) return 'user_document';
  return referenceId.startsWith('C') ? 'a2aj_case' : 'pinecone';
}

function normalizeParagraphNumbers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.floor(n));
}

function toRelevanceScore(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 80;
  const pct = Math.round(score * 100);
  return Math.max(0, Math.min(100, pct));
}

function toCitationId(value) {
  const text = toText(value);
  return text || null;
}

export function buildCitationFromSource(id, src = {}) {
  const referenceId = toCitationId(id);
  if (!referenceId) return null;

  const sourceType = toSourceType(referenceId, src?.sourceType);
  const title = toText(src?.title) || toText(src?.caseName) || toText(src?.source) || 'Source';
  const locator = sourceType === 'a2aj_case'
    ? [src?.court, src?.neutralCitation, src?.date].map(toText).filter(Boolean).join(' | ')
    : sourceType === 'user_document'
      ? [src?.documentName, src?.citation].map(toText).filter(Boolean).join(' | ')
      : [src?.manual, src?.chapter, src?.citation].map(toText).filter(Boolean).join(' | ');
  const url = toText(src?.url) || toText(src?.sourceUrl);
  const snippet = toText(src?.snippet) || toText(src?.text);
  const score = typeof src?.score === 'number' && Number.isFinite(src.score) ? src.score : undefined;
  const caseId = toText(src?.id) || referenceId;
  const citation = toText(src?.citation) || toText(src?.neutralCitation) || toText(src?.source) || referenceId;
  const paragraphNumbers = normalizeParagraphNumbers(
    Array.isArray(src?.paragraphNumbers) ? src.paragraphNumbers : src?.paragraphs
  );

  return {
    id: referenceId,
    referenceId,
    sourceType,
    title,
    locator: toOptionalText(locator),
    url: toOptionalText(url),
    snippet,
    score,
    metadata: src?.raw || undefined,

    // Backward-compatible fields
    caseId,
    caseName: title,
    citation,
    paragraphNumbers,
    relevanceScore: toRelevanceScore(score),
    manual: toOptionalText(src?.manual),
    chapter: toOptionalText(src?.chapter),
    headingPath: Array.isArray(src?.headingPath) ? src.headingPath.filter((s) => typeof s === 'string') : [],
    pageStart: typeof src?.pageStart === 'number' ? src.pageStart : undefined,
    pageEnd: typeof src?.pageEnd === 'number' ? src.pageEnd : undefined,
    sourceFile: toOptionalText(src?.sourceFile),
    sourceUrl: toOptionalText(url || src?.sourceUrl),
    sourceTypeLegacy: sourceType,
  };
}
