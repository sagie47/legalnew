import { embedText } from './embeddings.js';

export async function pineconeQuery({ query, topK = 6, namespace, filter, minScore = 0 }) {
  const apiKey = process.env.PINECONE_API_KEY;
  const host = process.env.PINECONE_INDEX_HOST;

  if (!apiKey || !host) {
    return [];
  }

  const vector = await embedText({ text: query, inputType: 'query' });
  if (!vector) {
    return [];
  }

  const endpoint = host.endsWith('/') ? host.slice(0, -1) : host;

  const response = await fetch(`${endpoint}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': apiKey
    },
    body: JSON.stringify({
      vector,
      topK,
      includeMetadata: true,
      includeValues: false,
      namespace,
      filter
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Pinecone query error: ${errText}`);
  }

  const data = await response.json();
  const matches = Array.isArray(data?.matches) ? data.matches : [];

  return matches
    .filter(m => (typeof m.score === 'number' ? m.score >= minScore : true))
    .map(m => {
      const md = m.metadata || {};
      return {
        id: m.id,
        score: m.score,
        text: md.text || md.content || md.chunk || '',
        title: md.title || md.caseName || md.name,
        source: md.source || md.url || md.docId,
        citation: md.citation,
        paragraphNumbers: md.paragraphNumbers || md.paras || [],
        manual: md.manual,
        chapter: md.chapter,
        headingPath: md.heading_path || md.headingPath || [],
        pageStart: md.page_start,
        pageEnd: md.page_end,
        sourceFile: md.source_file,
        sourceType: md.source_type,
        sourceUrl: md.source_url || md.url
      };
    });
}

export async function pineconeUpsert(_opts) {
  return { upsertedCount: 0 };
}
