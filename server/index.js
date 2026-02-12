import express from 'express';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { groqAnswer } from './clients/groq.js';
import { a2ajEnrichCaseSources, a2ajSearchDecisions, a2ajToCaseSources } from './clients/a2aj.js';
import { retrieveGrounding, buildPrompt, extractCitations, validateCitationTokens } from './rag/grounding.js';
import { routeIntent } from './rag/router.js';
import { detectPromptInjection, isRcicRelatedQuery, sanitizeUserMessage } from './rag/security.js';
import { appendMessage, dbEnabled, ensureSession, ensureUser, getRecentMessages, listHistory } from './db.js';
import { ingestPdiUrls, resolveIngestUrls } from './ingest/pdi/index.js';

dotenv.config();

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

function boolFlag(value, defaultValue) {
  if (typeof value === 'undefined') return defaultValue;
  return String(value).toLowerCase() === 'true';
}

function resolveExternalAuthId(req) {
  const raw = (
    req.headers['x-external-auth-id'] ||
    req.body?.externalAuthId ||
    req.query?.externalAuthId ||
    process.env.DEV_EXTERNAL_AUTH_ID ||
    'dev-user'
  );
  return typeof raw === 'string' && raw.trim() ? raw.trim() : 'dev-user';
}

function resolveUserEmail(req) {
  const raw = req.headers['x-user-email'] || req.body?.email || null;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function buildCitationFromSource(id, src) {
  const sourceType = src?.sourceType || (id.startsWith('C') ? 'a2aj_case' : 'pinecone');
  const title = src?.title || src?.caseName || src?.source || 'Source';
  const locator = sourceType === 'a2aj_case'
    ? [src?.court, src?.neutralCitation, src?.date].filter(Boolean).join(' | ')
    : [src?.manual, src?.chapter, src?.citation].filter(Boolean).join(' | ');
  const url = src?.url || src?.sourceUrl;
  const snippet = src?.snippet || src?.text || '';
  const score = typeof src?.score === 'number' ? src.score : undefined;

  return {
    id,
    referenceId: id,
    sourceType,
    title,
    locator: locator || undefined,
    url: url || undefined,
    snippet,
    score,
    metadata: src?.raw || undefined,

    // Backward-compatible fields
    caseId: src?.id || id,
    caseName: title,
    citation: src?.citation || src?.neutralCitation || src?.source || id,
    paragraphNumbers: Array.isArray(src?.paragraphNumbers) ? src.paragraphNumbers : (Array.isArray(src?.paragraphs) ? src.paragraphs : []),
    relevanceScore: typeof src?.score === 'number' ? Math.round(src.score * 100) : 80,
    manual: src?.manual,
    chapter: src?.chapter,
    headingPath: Array.isArray(src?.headingPath) ? src.headingPath : [],
    pageStart: src?.pageStart,
    pageEnd: src?.pageEnd,
    sourceFile: src?.sourceFile,
    sourceUrl: url || src?.sourceUrl,
    sourceTypeLegacy: sourceType,
  };
}

app.get('/api/history', async (req, res) => {
  if (!dbEnabled()) {
    return res.json({ sessions: [] });
  }

  try {
    const externalAuthId = resolveExternalAuthId(req);
    const email = resolveUserEmail(req);
    const userId = await ensureUser({ externalAuthId, email });
    const sessions = await listHistory({ userId });
    return res.json({ sessions });
  } catch (error) {
    console.error('History error:', error);
    return res.status(500).json({ sessions: [], error: 'Failed to load history.' });
  }
});

app.post('/api/chat', async (req, res) => {
  const message = req.body?.message;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  const externalAuthId = resolveExternalAuthId(req);
  const email = resolveUserEmail(req);
  const incomingSessionId = req.body?.sessionId;
  const requestedSessionId = isUuid(incomingSessionId) ? incomingSessionId : randomUUID();
  let sessionId = requestedSessionId;
  const topK = Number(process.env.RETRIEVAL_TOP_K || 6);
  const debugEnabled = boolFlag(process.env.DEBUG_MODE, false);
  const promptInjectionBlockingEnabled = boolFlag(process.env.PROMPT_INJECTION_BLOCK_ENABLED, true);
  const a2ajEnabled = boolFlag(process.env.A2AJ_ENABLED, true);
  const a2ajCaseLawEnabled = boolFlag(process.env.A2AJ_CASELAW_ENABLED, true);
  const a2ajLegislationEnabled = boolFlag(process.env.A2AJ_LEGISLATION_ENABLED, false);
  const defaultA2ajTopK = Number(process.env.A2AJ_TOP_K || 4);

  try {
    let userId = null;
    let history = [];
    if (dbEnabled()) {
      userId = await ensureUser({ externalAuthId, email });
      const title = message.slice(0, 80);
      let session = await ensureSession({ sessionId, userId, title });
      if (!session) {
        const fallbackSessionId = randomUUID();
        console.warn(
          `Session ownership mismatch for user ${externalAuthId} on ${sessionId}; creating new session ${fallbackSessionId}.`
        );
        sessionId = fallbackSessionId;
        session = await ensureSession({ sessionId, userId, title });
      }
      if (!session) {
        return res.status(500).json({ error: 'failed to initialize session' });
      }
      history = await getRecentMessages({ sessionId, userId, limit: 12 });
      await appendMessage({ sessionId, userId, role: 'user', content: message });
    }

    const promptSafety = detectPromptInjection(message);
    const sanitizedMessage = sanitizeUserMessage(message);
    const effectiveMessage = sanitizedMessage || message;
    const rcicRelated = isRcicRelatedQuery(effectiveMessage);

    if (promptInjectionBlockingEnabled && promptSafety.detected && !rcicRelated) {
      const blockedText = 'I can only assist with RCIC-focused Canadian immigration research. Please rephrase your question without instruction-overrides.';
      if (dbEnabled() && userId) {
        await appendMessage({
          sessionId,
          userId,
          role: 'assistant',
          content: blockedText,
          citations: [],
        });
      }
      return res.json({
        text: blockedText,
        citations: [],
        sessionId,
        ...(debugEnabled
          ? {
              debug: {
                promptSafety,
                rcicRelated,
              },
            }
          : {}),
      });
    }

    const grounding = await retrieveGrounding({ query: effectiveMessage, topK });
    const routeDecision = await routeIntent({
      message: effectiveMessage,
      a2ajEnabled,
      a2ajCaseLawEnabled,
      a2ajLegislationEnabled,
    });

    let caseLawSources = [];
    if (a2ajEnabled && routeDecision.useCaseLaw && a2ajCaseLawEnabled) {
      try {
        const searchResults = await a2ajSearchDecisions({
          query: routeDecision.query || effectiveMessage,
          limit: routeDecision.limit || defaultA2ajTopK,
          filters: {
            courts: routeDecision.courts,
            yearFrom: routeDecision.yearFrom,
            yearTo: routeDecision.yearTo,
          },
        });
        caseLawSources = a2ajToCaseSources(searchResults).slice(0, routeDecision.limit || defaultA2ajTopK);
        caseLawSources = await a2ajEnrichCaseSources({
          sources: caseLawSources,
          query: effectiveMessage,
        });
      } catch (a2ajError) {
        console.warn('A2AJ retrieval failed; continuing with Pinecone-only grounding.', a2ajError?.message || a2ajError);
      }
    }

    const { system, user, citationMap } = buildPrompt({
      query: effectiveMessage,
      grounding: {
        ...grounding,
        caseLaw: caseLawSources,
      },
      history,
    });

    const { text } = await groqAnswer({
      systemPrompt: system,
      userPrompt: user,
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    });

    const validatedText = validateCitationTokens(text, citationMap);
    const citationIds = extractCitations(validatedText);
    const citations = citationIds
      .map((id) => buildCitationFromSource(id, citationMap[id] || {}))
      .filter(Boolean);

    if (dbEnabled() && userId) {
      await appendMessage({
        sessionId,
        userId,
        role: 'assistant',
        content: validatedText,
        citations,
      });
    }

    const payload = {
      text: validatedText,
      citations,
      sessionId,
      ...(debugEnabled
        ? {
            debug: {
              routeDecision,
              promptSafety,
              rcicRelated,
              pineconeCount: Array.isArray(grounding.pinecone) ? grounding.pinecone.length : 0,
              caseLawCount: caseLawSources.length,
            },
          }
        : {}),
    };

    return res.json(payload);
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({
      text: 'Server error while generating response.',
      citations: [],
      sessionId,
    });
  }
});

app.post('/api/ingest', async (_req, res) => {
  return res.json({ ok: false, message: 'Ingest not implemented yet.' });
});

app.post('/api/ingest/pdi', async (req, res) => {
  const urls = resolveIngestUrls(req.body || {});
  if (urls.length === 0) {
    return res.status(400).json({
      status: 'error',
      error: 'Provide "url" or "urls" with at least one valid URL.',
    });
  }

  const namespace = typeof req.body?.namespace === 'string' && req.body.namespace.trim()
    ? req.body.namespace.trim()
    : process.env.PINECONE_NAMESPACE || 'ircc';
  const dryRun = Boolean(req.body?.dryRun);

  try {
    const result = await ingestPdiUrls({
      urls,
      namespace,
      dryRun,
    });
    return res.json(result);
  } catch (error) {
    console.error('PDI ingest pipeline error:', error);
    return res.status(500).json({
      status: 'error',
      ingested: 0,
      skipped: urls.length,
      errors: [{ stage: 'pipeline', message: error?.message || 'Unexpected ingestion error' }],
      stats: { totalSections: 0, totalChunks: 0 },
    });
  }
});

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => {
  console.log(`API server listening on http://${host}:${port}`);
});
