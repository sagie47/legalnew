import { chunkTextWithOverlap } from '../ingest/pdi/chunk.js';

function toInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function scoreChunk(queryTokens, text) {
  if (queryTokens.length === 0 || !text) return 0;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const token of queryTokens) {
    if (lower.includes(token)) hits += 1;
  }
  const density = hits / queryTokens.length;
  const bonus = lower.includes(queryTokens.join(' ')) ? 0.25 : 0;
  return Math.min(1, density + bonus);
}

function toSnippet(value, maxChars = 1200) {
  const text = normalizeText(value);
  if (!text) return '';
  return text.slice(0, maxChars);
}

export function chunkUserDocumentText(text, options = {}) {
  const cleaned = normalizeText(text);
  if (!cleaned) return [];

  const chunks = chunkTextWithOverlap(cleaned, {
    maxChars: toInt(options.maxChars || process.env.DOC_CHUNK_MAX_CHARS, 2200, 200, 8000),
    minChars: toInt(options.minChars || process.env.DOC_CHUNK_MIN_CHARS, 500, 100, 4000),
    overlapChars: toInt(options.overlapChars || process.env.DOC_CHUNK_OVERLAP_CHARS, 300, 0, 2000),
  });

  return chunks.map((chunk, index) => ({
    chunk_index: index,
    text: chunk.text,
    start_char: chunk.start,
    end_char: chunk.end,
  }));
}

export function rankDocumentChunks({ query, chunks, topK = 4 } = {}) {
  if (!Array.isArray(chunks) || chunks.length === 0) return [];

  const queryTokens = tokenize(query);
  const safeTopK = toInt(topK || process.env.DOCUMENT_TOP_K, 4, 1, 12);
  const scored = chunks
    .map((row) => {
      const metadata = parseMetadata(row?.metadata);
      const text = normalizeText(row?.text || row?.chunk_text);
      const score = scoreChunk(queryTokens, text);
      return {
        row,
        metadata,
        text,
        score,
      };
    })
    .filter((entry) => entry.text)
    .sort((a, b) => b.score - a.score || Number(a.row?.chunk_index || 0) - Number(b.row?.chunk_index || 0))
    .slice(0, safeTopK);

  return scored.map(({ row, metadata, text, score }) => {
    const sourceUrl = metadata.source_url || row?.source_url || '';
    const documentTitle = row?.title || metadata.title || 'User Document';
    const chunkIndex = Number.isFinite(Number(row?.chunk_index)) ? Number(row.chunk_index) : 0;
    return {
      sourceType: 'user_document',
      id: row?.chunk_id || `doc-${row?.document_id || 'unknown'}-${chunkIndex}`,
      title: documentTitle,
      documentId: row?.document_id || metadata.document_id,
      documentName: documentTitle,
      citation: `Document chunk ${chunkIndex + 1}`,
      url: sourceUrl || undefined,
      sourceUrl: sourceUrl || undefined,
      snippet: toSnippet(text),
      score,
      raw: {
        ...metadata,
        chunk_index: chunkIndex,
        source_file: row?.source_file || metadata.source_file,
      },
    };
  });
}
