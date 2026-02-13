import { createHash, randomBytes } from 'node:crypto';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function nowIso() {
  return new Date().toISOString();
}

function toText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function hashText(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function encodeTime(timeMs, length = 10) {
  let value = Number(timeMs);
  const out = Array(length).fill('0');
  for (let i = length - 1; i >= 0; i -= 1) {
    const mod = value % 32;
    out[i] = ULID_ALPHABET[mod];
    value = Math.floor(value / 32);
  }
  return out.join('');
}

function encodeRandom(length = 16) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ULID_ALPHABET[bytes[i] % 32];
  }
  return out;
}

function createUlid() {
  return `${encodeTime(Date.now(), 10)}${encodeRandom(16)}`;
}

function redactMessage(text) {
  const clean = String(text || '');
  if (!clean) return '';
  return clean
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b\d{6,}\b/g, '[REDACTED_NUMBER]')
    .slice(0, 300);
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function startRunTrace({
  sessionId,
  message,
  analysisDateBasis = 'today',
  includeRedactedMessage = false,
  budgets = {},
  modelVersion = '',
  promptVersion = 'v1',
  policyVersion = 'v1.0.0',
} = {}) {
  const createdAt = nowIso();
  return {
    runId: createUlid(),
    schemaVersion: 'v1.0.0',
    createdAt,
    status: 'in_progress',
    analysisDateBasis,
    inputs: {
      messageHash: hashText(message),
      sessionId: toText(sessionId),
      ...(includeRedactedMessage ? { redactedMessage: redactMessage(message) } : {}),
    },
    plan: {
      budgets: {
        maxToolCalls: safeNumber(budgets.maxToolCalls, 0),
        maxLiveFetches: safeNumber(budgets.maxLiveFetches, 0),
        maxRetries: safeNumber(budgets.maxRetries, 0),
      },
    },
    retrieval: null,
    liveFetches: [],
    validation: {
      guardIssues: [],
      failureState: null,
      citationIds: [],
    },
    outputs: null,
    meta: {
      modelVersion: toText(modelVersion),
      promptVersion: toText(promptVersion) || 'v1',
      policyVersion: toText(policyVersion) || 'v1.0.0',
    },
    events: [],
  };
}

export function appendRunTraceEvent(trace, eventType, payload = {}) {
  if (!trace) return;
  const type = toText(eventType);
  if (!type) return;

  const event = {
    type,
    at: nowIso(),
    payload: payload && typeof payload === 'object' ? payload : {},
  };
  trace.events.push(event);

  if (type === 'retrieval_complete') {
    trace.retrieval = {
      queryHash: toText(payload.queryHash),
      filters: payload.filters || null,
      tiers: payload.tiers || null,
      topSourceIds: Array.isArray(payload.topSourceIds) ? payload.topSourceIds : [],
    };
  } else if (type === 'live_fetch_complete') {
    trace.liveFetches.push({
      source: toText(payload.source),
      canonicalUrl: toText(payload.canonicalUrl),
      retrievedAt: toText(payload.retrievedAt) || nowIso(),
      contentHash: toText(payload.contentHash),
      allowlistResult: toText(payload.allowlistResult),
    });
  } else if (type === 'prompt_built') {
    trace.meta.promptHash = toText(payload.promptHash);
    trace.meta.systemPromptHash = toText(payload.systemPromptHash);
    trace.meta.userPromptHash = toText(payload.userPromptHash);
  } else if (type === 'validation_complete') {
    trace.validation.guardIssues = Array.isArray(payload.guardIssues) ? payload.guardIssues : [];
    trace.validation.citationIds = Array.isArray(payload.citationIds) ? payload.citationIds : [];
    trace.validation.failureState = toText(payload.failureState) || null;
  } else if (type === 'failure_state') {
    trace.validation.failureState = toText(payload.failureState) || null;
  }
}

export function finalizeRunTrace(trace, {
  status = 'ok',
  responseText = '',
  citations = [],
  errorCode = '',
  errorMessage = '',
} = {}) {
  if (!trace) return null;
  const completedAt = nowIso();
  trace.status = status === 'error' ? 'error' : 'ok';
  trace.completedAt = completedAt;
  trace.durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(trace.createdAt || completedAt));
  trace.outputs = {
    responseHash: hashText(responseText),
    citationCount: Array.isArray(citations) ? citations.length : 0,
  };
  if (trace.status === 'error') {
    trace.error = {
      code: toText(errorCode) || 'CHAT_ERROR',
      message: toText(errorMessage) || 'Unhandled chat error',
    };
  }
  return trace;
}

export function summarizeRunTrace(trace) {
  if (!trace) return null;
  return {
    runId: trace.runId,
    schemaVersion: trace.schemaVersion,
    status: trace.status,
    analysisDateBasis: trace.analysisDateBasis,
    createdAt: trace.createdAt,
    durationMs: trace.durationMs,
    failureState: trace.validation?.failureState || null,
    guardIssues: trace.validation?.guardIssues || [],
    retrieval: {
      queryHash: trace.retrieval?.queryHash || '',
      topSourceIds: trace.retrieval?.topSourceIds || [],
    },
    liveFetchCount: Array.isArray(trace.liveFetches) ? trace.liveFetches.length : 0,
    outputs: trace.outputs || null,
  };
}

export function buildPromptHashes({ systemPrompt = '', userPrompt = '' } = {}) {
  return {
    promptHash: hashText(`${systemPrompt}\n\n${userPrompt}`),
    systemPromptHash: hashText(systemPrompt),
    userPromptHash: hashText(userPrompt),
  };
}
