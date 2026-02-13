import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const MATRIX_PATH = join(PROJECT_ROOT, 'eval', 'failure_state_matrix.json');

let cachedMatrix = null;

export function loadFailureStateMatrix() {
  if (cachedMatrix) {
    return cachedMatrix;
  }
  
  const content = readFileSync(MATRIX_PATH, 'utf-8');
  cachedMatrix = JSON.parse(content);
  return cachedMatrix;
}

export function getFailureStateInfo(code, matrix = null) {
  const m = matrix || loadFailureStateMatrix();
  
  const state = m.failure_states.find(s => s.code === code);
  
  if (!state) {
    throw new Error(`Unknown failure state: ${code}`);
  }
  
  return state;
}

export function getAllFailureStateCodes(matrix = null) {
  const m = matrix || loadFailureStateMatrix();
  return m.failure_states.map(s => s.code);
}

export function isRetryableFailure(code, matrix = null) {
  const m = matrix || loadFailureStateMatrix();
  const state = m.failure_states.find(s => s.code === code);
  
  if (!state) {
    return false;
  }
  
  return state.retry_policy !== 'N/A' && state.retry_policy !== 'REQUEST_MORE_INFO';
}
