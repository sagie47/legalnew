import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAuditRunTraceContract,
  completeRunTracePhase,
  finalizeRunTrace,
  startRunTrace,
  startRunTracePhase,
  summarizeRunTrace,
  validateAuditRunTraceContract,
} from '../auditTrace.js';

test('auditTrace builds schema-compatible contract with phases', () => {
  const trace = startRunTrace({
    sessionId: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
    message: 'Test query about IRPA section 40',
    analysisDateBasis: 'explicit_as_of',
    asOfDate: '2026-02-13',
    includeRedactedMessage: true,
    topK: 6,
    budgets: { maxToolCalls: 8, maxLiveFetches: 3, maxRetries: 1 },
    modelVersion: 'llama-3.3-70b-versatile',
  });

  startRunTracePhase(trace, 'RETRIEVAL', { top_k: 6 });
  completeRunTracePhase(trace, 'RETRIEVAL', {
    outputs: { pinecone_count: 4, tier_a_count: 2, tier_b_count: 2, tier_c_count: 0 },
  });

  startRunTracePhase(trace, 'ROUTING', { use_a2aj: false });
  completeRunTracePhase(trace, 'ROUTING', {
    outputs: { use_case_law: false },
    status: 'SUCCESS',
  });

  finalizeRunTrace(trace, {
    status: 'ok',
    responseText: 'IRPA section 40 addresses misrepresentation [P1].',
    citations: [{ id: 'P1' }],
  });

  const contract = buildAuditRunTraceContract(trace);
  const validation = validateAuditRunTraceContract(contract);

  assert.equal(validation.valid, true);
  assert.equal(contract.as_of, '2026-02-13');
  assert.equal(typeof contract.run_id, 'string');
  assert.equal(contract.run_id.length, 26);
  assert.equal(Array.isArray(contract.phases), true);
  assert.equal(contract.phases.length >= 1, true);
  assert.equal(contract.metadata.retrieval_top_k, 6);
});

test('auditTrace validator rejects invalid contracts', () => {
  const invalid = {
    trace_id: '',
    run_id: 'not-a-ulid',
    query: '',
    as_of: '13-02-2026',
    phases: [],
  };

  const validation = validateAuditRunTraceContract(invalid);

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.length > 0, true);
});

test('auditTrace summary includes contract validation snapshot', () => {
  const trace = startRunTrace({
    sessionId: '22222222-2222-4222-8222-222222222222',
    message: 'Study permit question',
    topK: 5,
  });

  startRunTracePhase(trace, 'GENERATION', { model: 'llama-3.3-70b-versatile' });
  completeRunTracePhase(trace, 'GENERATION', {
    outputs: { response_chars: 128 },
  });

  finalizeRunTrace(trace, {
    status: 'ok',
    responseText: 'Summary response.',
    citations: [],
  });

  const summary = summarizeRunTrace(trace);

  assert.equal(typeof summary.runId, 'string');
  assert.equal(typeof summary.contractValidation, 'object');
  assert.equal(summary.contractValidation.valid, true);
  assert.equal(Array.isArray(summary.phaseStatuses), true);
  assert.equal(summary.phaseStatuses.length >= 1, true);
});
