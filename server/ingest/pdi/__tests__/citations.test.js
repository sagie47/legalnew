import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCitations, validateCitationTokens } from '../../../rag/grounding.js';
import { buildCitationFromSource } from '../../../rag/citations.js';

test('extractCitations normalizes case, spacing, and de-duplicates in first-seen order', () => {
  const text = 'Alpha [p1] beta [ C2 ] gamma [P1] delta [c2] epsilon [ d3 ]';
  const ids = extractCitations(text);
  assert.deepEqual(ids, ['P1', 'C2', 'D3']);
});

test('validateCitationTokens keeps only known ids and normalizes token case', () => {
  const text = 'One [p1], two [ c9 ] three [ C2 ] and [ d3 ]';
  const cleaned = validateCitationTokens(text, { P1: {}, C2: {}, D3: {} });
  assert.equal(cleaned, 'One [P1], two three [C2] and [D3]');
});

test('validateCitationTokens handles empty citation map without crashing', () => {
  const text = 'Facts [P1] and [C3] remain text.';
  const cleaned = validateCitationTokens(text, {});
  assert.equal(cleaned, 'Facts and remain text.');
});

test('buildCitationFromSource returns stable keys and normalized paragraph numbers', () => {
  const citation = buildCitationFromSource('C1', {
    title: 'Test Case',
    court: 'FC',
    neutralCitation: '2024 FC 123',
    text: 'Snippet from case details',
    paragraphs: [1, '2', 2.8, 'x'],
    score: 0.91,
  });

  assert.ok(citation);
  assert.equal(citation.id, 'C1');
  assert.equal(citation.referenceId, 'C1');
  assert.equal(citation.caseId, 'C1');
  assert.equal(citation.sourceType, 'a2aj_case');
  assert.equal(citation.title, 'Test Case');
  assert.equal(citation.snippet, 'Snippet from case details');
  assert.deepEqual(citation.paragraphNumbers, [1, 2, 2]);
  assert.equal(citation.relevanceScore, 91);
});

test('buildCitationFromSource returns null for empty reference id', () => {
  assert.equal(buildCitationFromSource('', {}), null);
  assert.equal(buildCitationFromSource('   ', {}), null);
});
