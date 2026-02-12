import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertPineconeVectors } from '../upsert.js';

function makeRecord(id, text = 'x') {
  return {
    id,
    values: [0.1, 0.2, 0.3],
    metadata: {
      text,
    },
  };
}

test('upsertPineconeVectors splits by maxVectorsPerBatch', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  process.env.PINECONE_API_KEY = 'test-key';
  process.env.PINECONE_INDEX_HOST = 'https://example.pinecone.io';

  global.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ upsertedCount: 2 }), { status: 200 });
  };

  try {
    const records = [makeRecord('a'), makeRecord('b'), makeRecord('c')];
    const result = await upsertPineconeVectors(records, 'ircc', {
      maxVectorsPerBatch: 2,
      maxRequestBytes: 2 * 1024 * 1024,
      retries: 0,
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].vectors.length, 2);
    assert.equal(calls[1].vectors.length, 1);
    assert.equal(result.errors.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('upsertPineconeVectors splits by maxRequestBytes', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  process.env.PINECONE_API_KEY = 'test-key';
  process.env.PINECONE_INDEX_HOST = 'https://example.pinecone.io';

  global.fetch = async (_url, options) => {
    calls.push(options.body);
    return new Response(JSON.stringify({ upsertedCount: 1 }), { status: 200 });
  };

  try {
    const records = [
      makeRecord('a', 'A'.repeat(700)),
      makeRecord('b', 'B'.repeat(700)),
    ];

    const result = await upsertPineconeVectors(records, 'ircc', {
      maxVectorsPerBatch: 1000,
      maxRequestBytes: 1200,
      retries: 0,
    });

    assert.equal(calls.length, 2);
    assert.equal(result.errors.length, 0);
    assert.equal(result.upsertedCount, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('upsertPineconeVectors retries on 429 and succeeds', async () => {
  const originalFetch = global.fetch;
  let attempts = 0;

  process.env.PINECONE_API_KEY = 'test-key';
  process.env.PINECONE_INDEX_HOST = 'https://example.pinecone.io';

  global.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response('rate limited', {
        status: 429,
        headers: { 'retry-after': '0' },
      });
    }
    return new Response(JSON.stringify({ upsertedCount: 1 }), { status: 200 });
  };

  try {
    const result = await upsertPineconeVectors([makeRecord('a')], 'ircc', {
      retries: 1,
      backoffBaseMs: 1,
      backoffMaxMs: 5,
      maxRequestBytes: 2 * 1024 * 1024,
      maxVectorsPerBatch: 1000,
    });

    assert.equal(attempts, 2);
    assert.equal(result.errors.length, 0);
    assert.equal(result.upsertedCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

