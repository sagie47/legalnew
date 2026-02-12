function toInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
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

async function withBackoff(fn, { retries = 4, baseMs = 400, maxMs = 10000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retryable = Boolean(error?.retryable || isRetryableNetworkError(error));
      if (!retryable || attempt >= retries) {
        break;
      }

      const delayMs = makeRetryDelayMs(attempt, {
        baseMs,
        maxMs,
        retryAfterMs: error?.retryAfterMs,
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function serializeUpsertBody(vectors, namespace) {
  return JSON.stringify({
    vectors,
    namespace,
  });
}

function estimateUpsertBodyBytes(vectors, namespace) {
  return Buffer.byteLength(serializeUpsertBody(vectors, namespace), 'utf8');
}

function buildUpsertBatches(records, namespace, { maxVectorsPerBatch, maxRequestBytes }) {
  const batches = [];
  let current = [];

  for (const record of records) {
    if (!record || typeof record !== 'object') {
      continue;
    }

    if (current.length === 0) {
      current.push(record);
      continue;
    }

    const wouldExceedCount = current.length >= maxVectorsPerBatch;
    const wouldExceedBytes = estimateUpsertBodyBytes([...current, record], namespace) > maxRequestBytes;
    if (wouldExceedCount || wouldExceedBytes) {
      batches.push(current);
      current = [record];
    } else {
      current.push(record);
    }
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

async function upsertBatch(vectors, namespace) {
  const apiKey = process.env.PINECONE_API_KEY;
  const host = (process.env.PINECONE_INDEX_HOST || '').replace(/\/$/, '');

  if (!apiKey) {
    throw new Error('PINECONE_API_KEY is required for upsert');
  }
  if (!host) {
    throw new Error('PINECONE_INDEX_HOST is required for upsert');
  }

  const body = serializeUpsertBody(vectors, namespace);
  const response = await fetch(`${host}/vectors/upsert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': apiKey,
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    const error = new Error(`Pinecone upsert error (${response.status}): ${errText}`);
    error.status = response.status;
    error.retryAfterMs = retryAfterMs;
    error.retryable = isRetryableStatus(response.status);
    throw error;
  }

  const payload = await response.json().catch(() => ({}));
  return Number(payload?.upsertedCount || vectors.length);
}

export async function upsertPineconeVectors(records, namespace, options = {}) {
  const hardMaxVectors = 1000;
  const hardMaxBytes = 2 * 1024 * 1024;
  const configuredBatchSize = toInt(options.batchSize || process.env.PDI_UPSERT_BATCH_SIZE, 100, 1, hardMaxVectors);
  const maxVectorsPerBatch = Math.min(
    configuredBatchSize,
    toInt(options.maxVectorsPerBatch || process.env.PDI_UPSERT_MAX_VECTORS_PER_BATCH, 200, 1, hardMaxVectors),
    hardMaxVectors
  );
  const maxRequestBytes = toInt(
    options.maxRequestBytes || process.env.PDI_UPSERT_MAX_REQUEST_BYTES,
    Math.floor(hardMaxBytes * 0.9),
    1024,
    hardMaxBytes
  );
  const retries = toInt(options.retries || process.env.PDI_UPSERT_RETRIES, 4, 0, 8);
  const backoffBaseMs = toInt(options.backoffBaseMs || process.env.PDI_UPSERT_BACKOFF_BASE_MS, 500, 10, 60000);
  const backoffMaxMs = toInt(options.backoffMaxMs || process.env.PDI_UPSERT_BACKOFF_MAX_MS, 12000, backoffBaseMs, 120000);
  const errors = [];

  if (!Array.isArray(records) || records.length === 0) {
    return { upsertedCount: 0, errors };
  }

  let upsertedCount = 0;
  const batches = buildUpsertBatches(records, namespace, {
    maxVectorsPerBatch,
    maxRequestBytes,
  });

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    try {
      const count = await withBackoff(
        () => upsertBatch(batch, namespace),
        { retries, baseMs: backoffBaseMs, maxMs: backoffMaxMs }
      );
      upsertedCount += count;
    } catch (error) {
      errors.push({
        stage: 'upsert',
        batch: i,
        size: batch.length,
        bytes: estimateUpsertBodyBytes(batch, namespace),
        message: error?.message || 'Upsert batch failed',
      });
    }
  }

  return { upsertedCount, errors };
}
