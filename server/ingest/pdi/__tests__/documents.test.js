import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkUserDocumentText, rankDocumentChunks } from '../../../rag/documents.js';

test('chunkUserDocumentText returns indexed chunks with character ranges', () => {
  const text = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}: procedural fairness and reasons.`).join('\n\n');
  const chunks = chunkUserDocumentText(text, {
    maxChars: 420,
    minChars: 120,
    overlapChars: 80,
  });

  assert.ok(Array.isArray(chunks));
  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].chunk_index, 0);
  assert.ok(typeof chunks[0].start_char === 'number');
  assert.ok(typeof chunks[0].end_char === 'number');
  assert.ok(chunks[0].end_char > chunks[0].start_char);
});

test('rankDocumentChunks prioritizes query-relevant chunks and maps user_document fields', () => {
  const rows = [
    {
      chunk_id: 'chunk-1',
      document_id: 'doc-1',
      chunk_index: 0,
      title: 'Client Refusal Letter',
      source_url: 'https://example.com/refusal',
      text: 'The officer refused the visitor visa and failed to address procedural fairness concerns.',
      metadata: JSON.stringify({ source_file: 'client/refusal.txt' }),
    },
    {
      chunk_id: 'chunk-2',
      document_id: 'doc-1',
      chunk_index: 1,
      title: 'Client Refusal Letter',
      source_url: 'https://example.com/refusal',
      text: 'This paragraph discusses unrelated logistics and appointment scheduling details.',
      metadata: JSON.stringify({ source_file: 'client/refusal.txt' }),
    },
  ];

  const ranked = rankDocumentChunks({
    query: 'visitor visa refusal procedural fairness',
    chunks: rows,
    topK: 2,
  });

  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].id, 'chunk-1');
  assert.equal(ranked[0].sourceType, 'user_document');
  assert.equal(ranked[0].title, 'Client Refusal Letter');
  assert.equal(ranked[0].sourceUrl, 'https://example.com/refusal');
  assert.ok((ranked[0].score || 0) >= (ranked[1].score || 0));
});

test('rankDocumentChunks parses object metadata and supports chunk_text fallback', () => {
  const ranked = rankDocumentChunks({
    query: 'medical inadmissibility',
    chunks: [
      {
        document_id: 'doc-2',
        chunk_index: 3,
        chunk_text: 'Officer concerns include potential excessive demand and medical inadmissibility.',
        metadata: { title: 'Medical Notes', source_url: 'https://example.com/medical' },
      },
    ],
    topK: 1,
  });

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].documentName, 'Medical Notes');
  assert.equal(ranked[0].sourceUrl, 'https://example.com/medical');
  assert.equal(ranked[0].citation, 'Document chunk 4');
});

