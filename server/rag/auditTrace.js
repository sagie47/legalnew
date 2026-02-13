import { createHash, randomBytes } from 'node:crypto';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PHASE_NAMES = ['RETRIEVAL', 'ROUTING', 'GROUNDING', 'GENERATION', 'VALIDATION', 'RESPONSE_GUARD'];
const PHASE_NAME_SET = new Set(PHASE_NAMES);
const PHASE_STATUS_SET = new Set(['SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED']);

function nowIso() {
  return new Date().toISOString();
}

function isoDate(value) {
  const d = new Date(value || Date.now());
  if (Number.isNaN(d.getTime())) {
    return nowIso().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

function toText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
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

function normalizeDateInput(value) {
  const text = toText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return '';
}

function normalizePhaseStatus(value, fallback = 'SUCCESS') {
  const text = toText(value).toUpperCase();
  if (PHASE_STATUS_SET.has(text)) return text;
  return fallback;
}

function ensurePhase(trace, phaseName) {
  if (!trace || !PHASE_NAME_SET.has(phaseName)) return null;
  if (!Array.isArray(trace.phases)) trace.phases = [];
  if (!isObject(trace._phaseIndex)) trace._phaseIndex = {};

  const existingIndex = trace._phaseIndex[phaseName];
  if (typeof existingIndex === 'number' && trace.phases[existingIndex]) {
    return trace.phases[existingIndex];
  }

  const phase = {
    phase_id: `phase-${phaseName.toLowerCase()}-${trace.runId?.slice(-8) || '00000000'}`,
    phase_name: phaseName,
    started_at: '',
    completed_at: '',
    duration_ms: 0,
    inputs: {},
    outputs: {},
    errors: [],
    status: 'SKIPPED',
  };
  trace.phases.push(phase);
  trace._phaseIndex[phaseName] = trace.phases.length - 1;
  return phase;
}

function finalizeOpenPhases(trace, status, completedAt, errorCode = '', errorMessage = '') {
  if (!trace || !Array.isArray(trace.phases)) return;
  for (const phase of trace.phases) {
    if (!phase.started_at) {
      phase.started_at = trace.createdAt || completedAt;
    }
    if (!phase.completed_at) {
      phase.completed_at = completedAt;
      phase.duration_ms = Math.max(0, Date.parse(completedAt) - Date.parse(phase.started_at || completedAt));
      phase.status = status === 'error' ? 'FAILED' : 'SKIPPED';
      if (status === 'error') {
        phase.errors = [
          ...(Array.isArray(phase.errors) ? phase.errors : []),
          {
            code: toText(errorCode) || 'CHAT_ERROR',
            message: toText(errorMessage) || 'Unhandled chat error',
          },
        ];
      }
    }
  }
}

export function startRunTrace({
  sessionId,
  userId = '',
  message,
  analysisDateBasis = 'today',
  asOfDate = '',
  includeRedactedMessage = false,
  topK = 0,
  budgets = {},
  modelVersion = '',
  promptVersion = 'v1',
  policyVersion = 'v1.0.0',
} = {}) {
  const createdAt = nowIso();
  const runId = createUlid();
  const normalizedAsOfDate = normalizeDateInput(asOfDate) || isoDate(createdAt);
  const redactedQuery = includeRedactedMessage ? redactMessage(message) : '[REDACTED_BY_POLICY]';
  return {
    traceId: `trace-${runId}`,
    runId,
    schemaVersion: 'v1.0.0',
    createdAt,
    status: 'in_progress',
    analysisDateBasis,
    asOfDate: normalizedAsOfDate,
    inputs: {
      query: redactedQuery,
      messageHash: hashText(message),
      sessionId: toText(sessionId),
      ...(toText(userId) ? { userId: toText(userId) } : {}),
      ...(includeRedactedMessage ? { redactedMessage: redactedQuery } : {}),
    },
    plan: {
      topK: safeNumber(topK, 0),
      routeDecision: null,
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
    phases: [],
    _phaseIndex: {},
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
    if (isObject(payload.routeDecision)) {
      trace.plan.routeDecision = payload.routeDecision;
    }
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
  } else if (type === 'run_start') {
    trace.plan.topK = safeNumber(payload.topK, trace.plan?.topK || 0);
  } else if (type === 'validation_complete') {
    trace.validation.guardIssues = Array.isArray(payload.guardIssues) ? payload.guardIssues : [];
    trace.validation.citationIds = Array.isArray(payload.citationIds) ? payload.citationIds : [];
    trace.validation.failureState = toText(payload.failureState) || null;
  } else if (type === 'failure_state') {
    trace.validation.failureState = toText(payload.failureState) || null;
  }
}

export function startRunTracePhase(trace, phaseName, inputs = {}) {
  const normalizedPhaseName = toText(phaseName).toUpperCase();
  const phase = ensurePhase(trace, normalizedPhaseName);
  if (!phase) return null;
  if (!phase.started_at) {
    phase.started_at = nowIso();
  }
  if (isObject(inputs) && Object.keys(inputs).length > 0) {
    phase.inputs = {
      ...(isObject(phase.inputs) ? phase.inputs : {}),
      ...inputs,
    };
  }
  if (!phase.status || phase.status === 'SKIPPED') {
    phase.status = 'SUCCESS';
  }
  return phase;
}

export function completeRunTracePhase(trace, phaseName, {
  outputs = {},
  status = 'SUCCESS',
  errors = [],
} = {}) {
  const normalizedPhaseName = toText(phaseName).toUpperCase();
  const phase = ensurePhase(trace, normalizedPhaseName);
  if (!phase) return null;
  if (!phase.started_at) {
    phase.started_at = nowIso();
  }
  const completedAt = nowIso();
  phase.completed_at = completedAt;
  phase.duration_ms = Math.max(0, Date.parse(completedAt) - Date.parse(phase.started_at || completedAt));
  if (isObject(outputs) && Object.keys(outputs).length > 0) {
    phase.outputs = {
      ...(isObject(phase.outputs) ? phase.outputs : {}),
      ...outputs,
    };
  }
  phase.status = normalizePhaseStatus(status, 'SUCCESS');
  phase.errors = Array.isArray(errors)
    ? errors.filter((entry) => isObject(entry) && (toText(entry.code) || toText(entry.message)))
    : [];
  return phase;
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
  finalizeOpenPhases(trace, trace.status, completedAt, errorCode, errorMessage);
  if (!Array.isArray(trace.phases) || trace.phases.length === 0) {
    trace.phases = [{
      phase_id: `phase-retrieval-${trace.runId?.slice(-8) || '00000000'}`,
      phase_name: 'RETRIEVAL',
      started_at: trace.createdAt || completedAt,
      completed_at: completedAt,
      duration_ms: Math.max(0, Date.parse(completedAt) - Date.parse(trace.createdAt || completedAt)),
      inputs: {},
      outputs: {},
      errors: [],
      status: trace.status === 'error' ? 'FAILED' : 'SKIPPED',
    }];
  }
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

function toContractPhases(trace) {
  const phases = Array.isArray(trace?.phases) ? trace.phases : [];
  if (phases.length === 0) {
    return [{
      phase_id: `phase-retrieval-${toText(trace?.runId).slice(-8) || '00000000'}`,
      phase_name: 'RETRIEVAL',
      started_at: toText(trace?.createdAt) || nowIso(),
      status: 'SKIPPED',
    }];
  }
  return phases.map((phase) => ({
    phase_id: toText(phase.phase_id) || `phase-${toText(phase.phase_name).toLowerCase()}-${toText(trace?.runId).slice(-8) || '00000000'}`,
    phase_name: toText(phase.phase_name).toUpperCase() || 'RETRIEVAL',
    started_at: toText(phase.started_at) || toText(trace?.createdAt) || nowIso(),
    ...(toText(phase.completed_at) ? { completed_at: toText(phase.completed_at) } : {}),
    ...(Number.isFinite(Number(phase.duration_ms)) ? { duration_ms: safeNumber(phase.duration_ms, 0) } : {}),
    ...(isObject(phase.inputs) ? { inputs: phase.inputs } : {}),
    ...(isObject(phase.outputs) ? { outputs: phase.outputs } : {}),
    ...(Array.isArray(phase.errors) && phase.errors.length > 0 ? { errors: phase.errors } : {}),
    ...(toText(phase.status) ? { status: normalizePhaseStatus(phase.status, 'SUCCESS') } : {}),
  }));
}

export function buildAuditRunTraceContract(trace) {
  if (!trace) return null;
  const runId = toText(trace.runId) || createUlid();
  const modelVersion = toText(trace?.meta?.modelVersion);
  const retrieval = trace?.retrieval || {};
  const contract = {
    trace_id: toText(trace.traceId) || `trace-${runId}`,
    run_id: runId,
    query: toText(trace?.inputs?.query) || '[REDACTED_BY_POLICY]',
    as_of: normalizeDateInput(trace?.asOfDate) || isoDate(trace?.createdAt),
    phases: toContractPhases(trace),
    metadata: {
      ...(modelVersion ? { model_version: modelVersion } : {}),
      retrieval_top_k: safeNumber(trace?.plan?.topK, 0),
      tier_a_count: safeNumber(retrieval?.tiers?.binding?.count, 0),
      tier_b_count: safeNumber(retrieval?.tiers?.guidance?.count, 0),
      tier_c_count: safeNumber(retrieval?.tiers?.compare?.count, 0),
    },
    created_at: toText(trace?.createdAt) || nowIso(),
  };
  if (toText(trace?.inputs?.userId)) {
    contract.user_id = toText(trace.inputs.userId);
  }
  if (toText(trace?.completedAt)) {
    contract.completed_at = toText(trace.completedAt);
  }
  return contract;
}

export function validateAuditRunTraceContract(traceContract) {
  const errors = [];
  if (!isObject(traceContract)) {
    return { valid: false, errors: ['Trace contract must be an object'] };
  }

  const runId = toText(traceContract.run_id);
  if (!runId) errors.push('Missing required field: run_id');
  if (runId && !/^[0-9A-Z]{26}$/.test(runId)) errors.push('run_id must match ULID pattern');

  const traceId = toText(traceContract.trace_id);
  if (!traceId) errors.push('Missing required field: trace_id');

  const query = toText(traceContract.query);
  if (!query) errors.push('Missing required field: query');

  const asOf = toText(traceContract.as_of);
  if (!asOf) errors.push('Missing required field: as_of');
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) errors.push('as_of must be YYYY-MM-DD');

  const phases = Array.isArray(traceContract.phases) ? traceContract.phases : [];
  if (phases.length === 0) errors.push('phases must contain at least one phase');
  for (const phase of phases) {
    if (!isObject(phase)) {
      errors.push('phase entries must be objects');
      continue;
    }
    const phaseName = toText(phase.phase_name).toUpperCase();
    const phaseId = toText(phase.phase_id);
    const startedAt = toText(phase.started_at);
    if (!phaseId) errors.push('phase missing phase_id');
    if (!phaseName) errors.push('phase missing phase_name');
    if (phaseName && !PHASE_NAME_SET.has(phaseName)) errors.push(`invalid phase_name: ${phaseName}`);
    if (!startedAt) errors.push('phase missing started_at');
    if (startedAt && Number.isNaN(Date.parse(startedAt))) errors.push(`invalid started_at: ${startedAt}`);
    const completedAt = toText(phase.completed_at);
    if (completedAt && Number.isNaN(Date.parse(completedAt))) errors.push(`invalid completed_at: ${completedAt}`);
    const status = toText(phase.status).toUpperCase();
    if (status && !PHASE_STATUS_SET.has(status)) errors.push(`invalid phase status: ${status}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function persistRunTraceLog(trace, { sampleRate = 1 } = {}) {
  if (!trace) return false;
  const rate = Math.max(0, Math.min(1, Number(sampleRate)));
  if (Number.isFinite(rate) && Math.random() > rate) return false;
  try {
    const contract = buildAuditRunTraceContract(trace);
    const validation = validateAuditRunTraceContract(contract);
    console.log('[AUDIT_TRACE]', JSON.stringify({
      trace: contract,
      validation,
    }));
    return true;
  } catch (error) {
    console.error('Audit trace persistence error:', error?.message || error);
    return false;
  }
}

export function summarizeRunTrace(trace) {
  if (!trace) return null;
  const contract = buildAuditRunTraceContract(trace);
  const contractValidation = validateAuditRunTraceContract(contract);
  return {
    runId: trace.runId,
    traceId: trace.traceId,
    schemaVersion: trace.schemaVersion,
    status: trace.status,
    analysisDateBasis: trace.analysisDateBasis,
    asOfDate: trace.asOfDate,
    createdAt: trace.createdAt,
    durationMs: trace.durationMs,
    failureState: trace.validation?.failureState || null,
    guardIssues: trace.validation?.guardIssues || [],
    phaseCount: Array.isArray(trace.phases) ? trace.phases.length : 0,
    phaseStatuses: Array.isArray(trace.phases)
      ? trace.phases.map((phase) => ({ phase: phase.phase_name, status: phase.status }))
      : [],
    retrieval: {
      queryHash: trace.retrieval?.queryHash || '',
      topSourceIds: trace.retrieval?.topSourceIds || [],
    },
    liveFetchCount: Array.isArray(trace.liveFetches) ? trace.liveFetches.length : 0,
    outputs: trace.outputs || null,
    contractValidation,
  };
}

export function buildPromptHashes({ systemPrompt = '', userPrompt = '' } = {}) {
  return {
    promptHash: hashText(`${systemPrompt}\n\n${userPrompt}`),
    systemPromptHash: hashText(systemPrompt),
    userPromptHash: hashText(userPrompt),
  };
}
