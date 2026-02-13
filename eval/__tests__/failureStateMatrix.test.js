import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFailureStateMatrix, getFailureStateInfo, getAllFailureStateCodes } from '../failureStateMatrix.js';

const matrix = loadFailureStateMatrix();

test('Failure State Matrix: NO_BINDING_AUTHORITY is defined', () => {
  const state = getFailureStateInfo('NO_BINDING_AUTHORITY', matrix);
  assert.equal(state.code, 'NO_BINDING_AUTHORITY');
  assert.equal(state.severity, 'ERROR');
  assert.ok(state.user_message);
  assert.ok(state.retry_policy);
});

test('Failure State Matrix: STALE_VOLATILE_SOURCE is defined', () => {
  const state = getFailureStateInfo('STALE_VOLATILE_SOURCE', matrix);
  assert.equal(state.code, 'STALE_VOLATILE_SOURCE');
  assert.equal(state.severity, 'ERROR');
  assert.ok(state.required_audit_fields.length > 0);
});

test('Failure State Matrix: CITATION_MISMATCH is defined', () => {
  const state = getFailureStateInfo('CITATION_MISMATCH', matrix);
  assert.equal(state.code, 'CITATION_MISMATCH');
  assert.equal(state.severity, 'ERROR');
});

test('Failure State Matrix: OUT_OF_SCOPE_SOURCE is defined', () => {
  const state = getFailureStateInfo('OUT_OF_SCOPE_SOURCE', matrix);
  assert.equal(state.code, 'OUT_OF_SCOPE_SOURCE');
  assert.equal(state.severity, 'ERROR');
});

test('Failure State Matrix: BUDGET_EXCEEDED is defined', () => {
  const state = getFailureStateInfo('BUDGET_EXCEEDED', matrix);
  assert.equal(state.code, 'BUDGET_EXCEEDED');
  assert.equal(state.severity, 'WARNING');
});

test('Failure State Matrix: INSUFFICIENT_FACTS is defined', () => {
  const state = getFailureStateInfo('INSUFFICIENT_FACTS', matrix);
  assert.equal(state.code, 'INSUFFICIENT_FACTS');
  assert.equal(state.severity, 'INFO');
});

test('Failure State Matrix: INSUFFICIENT_EVIDENCE is defined', () => {
  const state = getFailureStateInfo('INSUFFICIENT_EVIDENCE', matrix);
  assert.equal(state.code, 'INSUFFICIENT_EVIDENCE');
  assert.equal(state.severity, 'WARNING');
});

test('Failure State Matrix: All required states are present', () => {
  const requiredStates = [
    'NONE',
    'NO_BINDING_AUTHORITY',
    'STALE_VOLATILE_SOURCE',
    'CITATION_MISMATCH',
    'OUT_OF_SCOPE_SOURCE',
    'BUDGET_EXCEEDED',
    'INSUFFICIENT_FACTS',
    'INSUFFICIENT_EVIDENCE'
  ];
  
  const allCodes = getAllFailureStateCodes(matrix);
  
  for (const state of requiredStates) {
    assert.ok(allCodes.includes(state), `Missing required state: ${state}`);
  }
});

test('Failure State Matrix: NONE has no retry policy', () => {
  const state = getFailureStateInfo('NONE', matrix);
  assert.equal(state.retry_policy, 'N/A');
});
