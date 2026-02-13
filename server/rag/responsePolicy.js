function toText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeBasis(value) {
  const basis = toText(value).toLowerCase();
  if (basis === 'application_date') return 'application_date';
  if (basis === 'explicit_as_of') return 'explicit_as_of';
  return 'today';
}

function normalizeDate(value) {
  const text = toText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return new Date().toISOString().slice(0, 10);
}

export function analysisDateHeader({ analysisDateBasis = 'today', asOfDate = '' } = {}) {
  const basis = normalizeBasis(analysisDateBasis);
  const date = normalizeDate(asOfDate);
  return `Analysis date basis: ${date} (${basis})`;
}

export function prependAnalysisDateHeader(text, { analysisDateBasis = 'today', asOfDate = '' } = {}) {
  const body = String(text || '').trim();
  const header = analysisDateHeader({ analysisDateBasis, asOfDate });
  if (body.startsWith('Analysis date basis:')) return body;
  if (!body) return header;
  return `${header}\n\n${body}`;
}
