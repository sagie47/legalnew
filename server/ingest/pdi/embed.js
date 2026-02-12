import pLimit from 'p-limit';

const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_CONCURRENCY = 2;

function toInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function chunkArray(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds * 1000);
  }

  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return null;
  const delta = dateMs - Date.now();
  return delta > 0 ? delta : 0;
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isRetryableNetworkError(error) {
  const code = error?.code;
  return code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    code === 'ENETUNREACH' ||
    code === 'EPIPE';
}

function makeRetryDelayMs(attempt, { baseMs, maxMs, retryAfterMs }) {
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(maxMs, retryAfterMs);
  }
  const exp = Math.min(maxMs, baseMs * (2 ** attempt));
  const jitter = Math.floor(Math.random() * Math.min(300, Math.max(1, Math.floor(baseMs / 2))));
  return Math.min(maxMs, exp + jitter);
}

async function requestEmbeddings(texts) {
  const apiKey = process.env.PINECONE_API_KEY;
  const baseUrl = (process.env.EMBEDDING_BASE_URL || 'https://api.pinecone.io').replace(/\/$/, '');
  const apiVersion = process.env.PINECONE_API_VERSION || '2025-10';
  const model = process.env.EMBEDDING_MODEL || 'llama-text-embed-v2';
  const dimension = toInt(process.env.EMBEDDING_DIM || 1024, 1024, 1, 4096);

  if (!apiKey) {
    throw new Error('PINECONE_API_KEY is required for embeddings');
  }

  const response = await fetch(`${baseUrl}/embed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': apiKey,
      'X-Pinecone-API-Version': apiVersion,
    },
    body: JSON.stringify({
      model,
      inputs: texts.map((text) => ({ text })),
      parameters: {
        input_type: 'passage',
        truncate: 'END',
        dimension,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    const error = new Error(`Embedding API error (${response.status}): ${errText}`);
    error.status = response.status;
    error.retryAfterMs = retryAfterMs;
    error.retryable = isRetryableStatus(response.status);
    throw error;
  }

  const payload = await response.json();
  const vectors = Array.isArray(payload?.data)
    ? payload.data.map((row) => row?.values)
    : [];

  if (vectors.length !== texts.length) {
    throw new Error(`Embedding count mismatch. Expected ${texts.length}, got ${vectors.length}`);
  }

  vectors.forEach((v, idx) => {
    if (!Array.isArray(v)) {
      throw new Error(`Embedding vector missing at index ${idx}`);
    }
  });

  return vectors;
}

async function withRetry(fn, retries = 1) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastErr = error;
      const retryable = Boolean(error?.retryable || isRetryableNetworkError(error));
      if (!retryable || attempt >= retries) {
        break;
      }

      const baseMs = toInt(process.env.PDI_EMBED_BACKOFF_BASE_MS, 400, 10, 60000);
      const maxMs = toInt(process.env.PDI_EMBED_BACKOFF_MAX_MS, 10000, baseMs, 120000);
      const delayMs = makeRetryDelayMs(attempt, {
        baseMs,
        maxMs,
        retryAfterMs: error?.retryAfterMs,
      });
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

export async function embedChunks(chunks, options = {}) {
  const batchSize = toInt(options.batchSize || process.env.PDI_EMBED_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 128);
  const concurrency = toInt(options.concurrency || process.env.PDI_EMBED_CONCURRENCY, DEFAULT_CONCURRENCY, 1, 8);
  const retries = toInt(options.retries || process.env.PDI_EMBED_RETRIES, 3, 0, 8);

  const vectors = Array(chunks.length).fill(null);
  const errors = [];
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { vectors, errors, embeddedCount: 0 };
  }

  const indexed = chunks.map((chunk, index) => ({ index, text: chunk.text }));
  const batches = chunkArray(indexed, batchSize);
  const limit = pLimit(concurrency);

  await Promise.all(
    batches.map((batch) =>
      limit(async () => {
        try {
          const texts = batch.map((item) => item.text);
          const embedded = await withRetry(() => requestEmbeddings(texts), retries);
          embedded.forEach((values, i) => {
            vectors[batch[i].index] = values;
          });
        } catch (error) {
          errors.push({
            stage: 'embed',
            startIndex: batch[0].index,
            endIndex: batch[batch.length - 1].index,
            message: error?.message || 'Embedding batch failed',
          });
        }
      })
    )
  );

  return {
    vectors,
    errors,
    embeddedCount: vectors.filter(Boolean).length,
  };
}
