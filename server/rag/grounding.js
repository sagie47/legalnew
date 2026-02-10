import { pineconeQuery } from '../clients/pinecone.js';

export async function retrieveGrounding({ query, topK = 6 }) {
  const pineconeResults = await pineconeQuery({ query, topK, namespace: process.env.PINECONE_NAMESPACE }).catch((err) => {
    console.error('Pinecone retrieval failed:', err);
    return [];
  });

  return {
    pinecone: Array.isArray(pineconeResults) ? pineconeResults : []
  };
}

export function buildPrompt({ query, grounding }) {
  const citationMap = {};

  const pineconeSnippets = grounding.pinecone
    .map((s, i) => {
      const id = `P${i + 1}`;
      citationMap[id] = s;
      return `${id}. ${s.text || ''}\nSource: ${s.source || s.title || s.id || 'pinecone'}`;
    })
    .join('\n\n');

  const contextBlock = [
    pineconeSnippets ? `PINECONE SOURCES:\n${pineconeSnippets}` : ''
  ].filter(Boolean).join('\n\n');

  const system = [
    'You are a legal research assistant. Use ONLY the provided sources.',
    'Cite every factual claim with source IDs in square brackets, e.g., [P1].',
    'If sources are insufficient, say so clearly.'
  ].join(' ');

  const user = contextBlock
    ? `Question: ${query}\n\nSources:\n${contextBlock}`
    : `Question: ${query}\n\nNo sources available.`;

  return { system, user, citationMap };
}

export function extractCitations(text) {
  const ids = new Set();
  const regex = /\[(P\d+)\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}
