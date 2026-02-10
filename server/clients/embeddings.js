const DEFAULT_TIMEOUT_MS = 20000;

export async function embedText({ text, inputType = 'query', truncate = 'END', dimension }) {
  const provider = process.env.EMBEDDING_PROVIDER || 'openai';

  if (provider === 'pinecone') {
    const apiKey = process.env.PINECONE_API_KEY;
    const model = process.env.EMBEDDING_MODEL || 'llama-text-embed-v2';
    const baseUrl = process.env.EMBEDDING_BASE_URL || 'https://api.pinecone.io';
    const apiVersion = process.env.PINECONE_API_VERSION || '2025-10';
    const expectedDim = Number(dimension || process.env.EMBEDDING_DIM || 0);

    if (!apiKey || !model) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Api-Key': apiKey,
          'X-Pinecone-API-Version': apiVersion
        },
        body: JSON.stringify({
          model,
          inputs: [{ text }],
          parameters: {
            input_type: inputType,
            truncate,
            ...(expectedDim ? { dimension: expectedDim } : {})
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Embedding API error: ${errText}`);
      }

      const data = await response.json();
      const vector = data?.data?.[0]?.values;
      if (!Array.isArray(vector)) {
        throw new Error('Embedding API did not return a vector');
      }

      if (expectedDim && vector.length !== expectedDim) {
        throw new Error(`Embedding dimension mismatch. Expected ${expectedDim}, got ${vector.length}.`);
      }

      return vector;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (provider !== 'openai' && provider !== 'openai_compat') {
    // Expect OpenAI-compatible embeddings by default.
    return null;
  }

  const apiKey = process.env.EMBEDDING_API_KEY;
  const model = process.env.EMBEDDING_MODEL;
  const baseUrl = process.env.EMBEDDING_BASE_URL || 'https://api.openai.com/v1/embeddings';

  if (!apiKey || !model) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: text
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Embedding API error: ${errText}`);
    }

    const data = await response.json();
    const vector = data?.data?.[0]?.embedding;
    if (!Array.isArray(vector)) {
      throw new Error('Embedding API did not return a vector');
    }

    const expectedDim = Number(process.env.EMBEDDING_DIM || 0);
    if (expectedDim && vector.length !== expectedDim) {
      throw new Error(`Embedding dimension mismatch. Expected ${expectedDim}, got ${vector.length}.`);
    }

    return vector;
  } finally {
    clearTimeout(timeout);
  }
}
