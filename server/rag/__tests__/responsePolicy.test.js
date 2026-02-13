import test from 'node:test';
import assert from 'node:assert/strict';

import { analysisDateHeader, prependAnalysisDateHeader } from '../responsePolicy.js';

test('analysisDateHeader uses explicit as_of date and basis', () => {
  const out = analysisDateHeader({
    analysisDateBasis: 'explicit_as_of',
    asOfDate: '2026-02-13',
  });
  assert.equal(out, 'Analysis date basis: 2026-02-13 (explicit_as_of)');
});

test('prependAnalysisDateHeader prepends header once', () => {
  const base = 'Binding authority says: IRPR 179(b)...';
  const out = prependAnalysisDateHeader(base, {
    analysisDateBasis: 'today',
    asOfDate: '2026-02-13',
  });
  assert.equal(
    out,
    'Analysis date basis: 2026-02-13 (today)\n\nBinding authority says: IRPR 179(b)...'
  );
});

test('prependAnalysisDateHeader is idempotent', () => {
  const already = 'Analysis date basis: 2026-02-13 (today)\n\nResponse text';
  const out = prependAnalysisDateHeader(already, {
    analysisDateBasis: 'application_date',
    asOfDate: '2025-01-01',
  });
  assert.equal(out, already);
});
