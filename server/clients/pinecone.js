import { embedText } from './embeddings.js';

function toText(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed;
}

function toOptionalText(value) {
  const text = toText(value);
  return text || undefined;
}

function parseHeadingPath(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string');
  }
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => typeof item === 'string');
    }
  } catch {
    // Keep raw text fallback below.
  }
  return [trimmed];
}

function parseInstrument(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => toText(item))
      .filter(Boolean);
  }
  const text = toText(value);
  if (!text) return [];
  if (!text.includes(',')) return [text];
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

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
        headingPath: parseHeadingPath(md.heading_path || md.headingPath),
        pageStart: md.page_start,
        pageEnd: md.page_end,
        sourceFile: md.source_file,
        sourceType: md.source_type,
        sourceUrl: md.source_url || md.url,
        authorityLevel: toOptionalText(md.authority_level),
        docFamily: toOptionalText(md.doc_family),
        instrument: parseInstrument(md.instrument),
        jurisdiction: toOptionalText(md.jurisdiction),
        effectiveDate: toOptionalText(md.effective_date),
        expiryDate: toOptionalText(md.expiry_date),
        sectionId: toOptionalText(md.section_id),
        programStream: toOptionalText(md.program_stream),
        nocCode: toOptionalText(md.noc_code),
        teer: toOptionalText(md.teer),
        tableType: toOptionalText(md.table_type),
        raw: md,
      };
    });
}

export async function pineconeUpsert(_opts) {
  return { upsertedCount: 0 };
}
