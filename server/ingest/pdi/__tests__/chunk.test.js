import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkSections, chunkTextWithOverlap } from '../chunk.js';

test('chunks text with overlap boundaries', () => {
  const text = 'maintained status guidance '.repeat(500);
  const chunks = chunkTextWithOverlap(text, { maxChars: 600, minChars: 120, overlapChars: 120 });

  assert.ok(chunks.length > 1);

  chunks.forEach((chunk, idx) => {
    if (idx < chunks.length - 1) {
      assert.ok(chunk.text.length <= 600);
    } else {
      assert.ok(chunk.text.length <= 720);
    }
    assert.ok(chunk.end > chunk.start);
  });

  for (let i = 1; i < chunks.length; i += 1) {
    assert.ok(chunks[i].start < chunks[i - 1].end);
  }
});

test('normalizes whitespace before chunking', () => {
  const raw = 'Line 1\r\n\r\n\r\n   Line   2\t\twith   spaces  \r\n\r\nLine 3   ';
  const chunks = chunkTextWithOverlap(raw, { maxChars: 500, overlapChars: 50 });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, 'Line 1\n\nLine 2 with spaces\n\nLine 3');
});

test('merges tiny trailing remainder into previous chunk', () => {
  const text = 'status '.repeat(380); // forces multiple chunks with small tail
  const chunks = chunkTextWithOverlap(text, {
    maxChars: 1000,
    minChars: 800,
    overlapChars: 100,
  });

  assert.equal(chunks.length, 2);
  assert.ok(chunks[1].text.length > 1000);
});

test('extends chunk boundary to avoid splitting table rows', () => {
  const row = `Column A: ${'x'.repeat(120)} | Column B: ${'y'.repeat(120)} | Column C: ${'z'.repeat(120)}`;
  const text = [
    'Intro paragraph before table.',
    'Table: Fees',
    row,
    'Paragraph after table.',
  ].join('\n');

  const chunks = chunkTextWithOverlap(text, {
    maxChars: 140,
    minChars: 40,
    overlapChars: 20,
    tableBoundaryBufferChars: 600,
  });

  assert.ok(chunks.length > 1);
  assert.ok(chunks[0].text.includes('Table: Fees'));
  assert.ok(chunks[0].text.includes(row));
});

test('preserves section metadata across chunked sections', () => {
  const sections = [
    {
      heading_path: ['Top', 'Sub'],
      top_heading: 'Top',
      anchor: '#a',
      text: 'x '.repeat(3000),
    },
  ];

  const chunks = chunkSections(sections, { maxChars: 700, overlapChars: 100 });
  assert.ok(chunks.length > 1);

  chunks.forEach((chunk, idx) => {
    assert.equal(chunk.section_index, 0);
    assert.equal(chunk.chunk_index, idx);
    assert.deepEqual(chunk.heading_path, ['Top', 'Sub']);
    assert.equal(chunk.top_heading, 'Top');
    assert.equal(chunk.anchor, '#a');
    assert.equal(chunk.est_tokens, Math.ceil(chunk.text.length / 4));
  });
});
