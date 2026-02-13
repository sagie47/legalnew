const FAILURE_STATE_MATRIX = {
  NONE: {
    code: 'NONE',
    severity: 'N/A',
    retryPolicy: 'N/A',
    userMessage: null,
  },
  NO_BINDING_AUTHORITY: {
    code: 'NO_BINDING_AUTHORITY',
    severity: 'ERROR',
    retryPolicy: 'RETRY_WITH_BETTER_SOURCES',
    userMessage: 'No binding authority found in indexed sources for this question.',
  },
  STALE_VOLATILE_SOURCE: {
    code: 'STALE_VOLATILE_SOURCE',
    severity: 'ERROR',
    retryPolicy: 'RETRY_WITH_REFRESHED_SOURCES',
    userMessage: 'Date sensitivity note: retrieved sources did not include effective-date metadata for citation-level recency validation.',
  },
  CITATION_MISMATCH: {
    code: 'CITATION_MISMATCH',
    severity: 'ERROR',
    retryPolicy: 'RETRY_WITH_CITATION_FIX',
    userMessage: 'Some citations in the response could not be verified against the retrieved sources.',
  },
  OUT_OF_SCOPE_SOURCE: {
    code: 'OUT_OF_SCOPE_SOURCE',
    severity: 'ERROR',
    retryPolicy: 'RETRY_WITH_SCOPED_SOURCES',
    userMessage: 'The request is outside approved RCIC scope or includes blocked instructions/sources.',
  },
  BUDGET_EXCEEDED: {
    code: 'BUDGET_EXCEEDED',
    severity: 'WARNING',
    retryPolicy: 'RETRY_WITH_REDUCED_SCOPE',
    userMessage: 'The request could not be fully processed due to resource constraints.',
  },
  INSUFFICIENT_FACTS: {
    code: 'INSUFFICIENT_FACTS',
    severity: 'INFO',
    retryPolicy: 'REQUEST_MORE_INFO',
    userMessage: 'Please provide more case facts (program, dates, status history, and target outcome).',
  },
  INSUFFICIENT_EVIDENCE: {
    code: 'INSUFFICIENT_EVIDENCE',
    severity: 'WARNING',
    retryPolicy: 'RETRY_WITH_EXPANDED_SEARCH',
    userMessage: 'Insufficient information available in retrieved sources to answer this query reliably.',
  },
};

const RESPONSE_NOTICE_STATES = new Set([
  'NO_BINDING_AUTHORITY',
  'STALE_VOLATILE_SOURCE',
  'CITATION_MISMATCH',
  'BUDGET_EXCEEDED',
  'INSUFFICIENT_FACTS',
  'INSUFFICIENT_EVIDENCE',
]);
const FAILURE_STATE_PRECEDENCE = [
  'OUT_OF_SCOPE_SOURCE',
  'BUDGET_EXCEEDED',
  'CITATION_MISMATCH',
  'STALE_VOLATILE_SOURCE',
  'NO_BINDING_AUTHORITY',
  'INSUFFICIENT_EVIDENCE',
  'INSUFFICIENT_FACTS',
  'NONE',
];

const VAGUE_QUERY_PATTERNS = [
  /\bhelp me\b/i,
  /\bbest immigration pathway\b/i,
  /\bbest pathway\b/i,
  /\bwhat should i do\b/i,
  /\badvise me\b/i,
  /\bmy case\b/i,
];

function toText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hasGuardIssue(issues, issueCode) {
  return Array.isArray(issues) && issues.includes(issueCode);
}

function looksInsufficientFacts(query) {
  const q = toText(query);
  if (!q) return true;
  if (q.length < 16) return true;
  return VAGUE_QUERY_PATTERNS.some((pattern) => pattern.test(q));
}

export function getFailureStateInfo(code) {
  const normalized = toText(code).toUpperCase();
  return FAILURE_STATE_MATRIX[normalized] || FAILURE_STATE_MATRIX.NONE;
}

export function applyFailureStateNotice(text, code) {
  const info = getFailureStateInfo(code);
  const clean = String(text || '').trim();
  const message = toText(info?.userMessage);
  if (!message) return clean;
  if (!RESPONSE_NOTICE_STATES.has(info.code)) return clean;
  if (clean.includes(message)) return clean;
  if (!clean) return message;
  return `${message}\n\n${clean}`;
}

export function resolveFailureState({
  query = '',
  guardIssues = [],
  outOfScopeBlocked = false,
  retrieval = null,
  citations = [],
  budget = {},
} = {}) {
  if (outOfScopeBlocked) return 'OUT_OF_SCOPE_SOURCE';

  const maxToolCalls = toNumber(budget.maxToolCalls, 0);
  const maxLiveFetches = toNumber(budget.maxLiveFetches, 0);
  const usedToolCalls = toNumber(budget.usedToolCalls, 0);
  const usedLiveFetches = toNumber(budget.usedLiveFetches, 0);
  const exceededToolBudget = maxToolCalls > 0 && usedToolCalls > maxToolCalls;
  const exceededLiveFetchBudget = maxLiveFetches > 0 && usedLiveFetches > maxLiveFetches;
  if (exceededToolBudget || exceededLiveFetchBudget) {
    return 'BUDGET_EXCEEDED';
  }

  if (hasGuardIssue(guardIssues, 'binding_claim_without_binding_citation')) {
    return 'CITATION_MISMATCH';
  }

  if (hasGuardIssue(guardIssues, 'temporal_claim_without_effective_date')) {
    return 'STALE_VOLATILE_SOURCE';
  }

  if (hasGuardIssue(guardIssues, 'no_binding_authority_found')) {
    return 'NO_BINDING_AUTHORITY';
  }

  const pineconeCount = toNumber(retrieval?.topSourceIds?.length, 0);
  const hasAnyCitations = Array.isArray(citations) && citations.length > 0;
  if (pineconeCount === 0 && !hasAnyCitations) {
    return 'INSUFFICIENT_EVIDENCE';
  }

  if (looksInsufficientFacts(query)) {
    return 'INSUFFICIENT_FACTS';
  }

  return 'NONE';
}

export function failureStateCodes() {
  return Object.keys(FAILURE_STATE_MATRIX);
}

export function failureStatePrecedence() {
  return [...FAILURE_STATE_PRECEDENCE];
}
