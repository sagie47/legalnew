import express from 'express';
import dotenv from 'dotenv';
import { groqRespond } from './clients/groq.js';
import { retrieveGrounding, buildPrompt, extractCitations } from './rag/grounding.js';

dotenv.config();

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/chat', async (req, res) => {
  const message = req.body?.message;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  const topK = Number(process.env.RETRIEVAL_TOP_K || 6);

  try {
    const grounding = await retrieveGrounding({ query: message, topK });
    const { system, user, citationMap } = buildPrompt({ query: message, grounding });

    const mcpServers = [];
    if (process.env.MCP_BASE_URL) {
      mcpServers.push({
        label: 'a2aj',
        url: process.env.MCP_BASE_URL,
        description: 'Canadian legal data: case law + legislation for citations',
        headers: process.env.MCP_API_KEY ? { Authorization: `Bearer ${process.env.MCP_API_KEY}` } : undefined,
        requireApproval: 'never',
      });
    }
    if (process.env.MCP_BASE_URL_SECONDARY) {
      mcpServers.push({
        label: 'a2aj_secondary',
        url: process.env.MCP_BASE_URL_SECONDARY,
        description: 'Canadian legal data: case law + legislation for citations (secondary)',
        headers: process.env.MCP_API_KEY ? { Authorization: `Bearer ${process.env.MCP_API_KEY}` } : undefined,
        requireApproval: 'never',
      });
    }

    const { text } = await groqRespond({
      systemPrompt: system,
      userPrompt: user,
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      mcpServers
    });

    const citationIds = extractCitations(text);
    const citations = citationIds.map((id) => {
      const src = citationMap[id] || {};
      return {
        caseId: src.id || id,
        caseName: src.title || src.source || 'Source',
        citation: src.citation || src.source || id,
        paragraphNumbers: Array.isArray(src.paragraphNumbers) ? src.paragraphNumbers : [],
        relevanceScore: typeof src.score === 'number' ? Math.round(src.score * 100) : 80,
        title: src.title,
        manual: src.manual,
        chapter: src.chapter,
        headingPath: Array.isArray(src.headingPath) ? src.headingPath : [],
        pageStart: src.pageStart,
        pageEnd: src.pageEnd,
        sourceFile: src.sourceFile,
        sourceType: src.sourceType,
        sourceUrl: src.sourceUrl,
        snippet: src.text
      };
    });

    return res.json({ text, citations });
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({
      text: 'Server error while generating response.',
      citations: []
    });
  }
});

app.post('/api/ingest', async (_req, res) => {
  return res.json({ ok: false, message: 'Ingest not implemented yet.' });
});

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => {
  console.log(`API server listening on http://${host}:${port}`);
});
