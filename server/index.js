import express from 'express';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { groqAnswer } from './clients/groq.js';
import { a2ajEnrichCaseSources, a2ajSearchDecisions, a2ajToCaseSources } from './clients/a2aj.js';
import { retrieveGrounding, buildPrompt, extractCitations, validateCitationTokens } from './rag/grounding.js';
import { buildCitationFromSource } from './rag/citations.js';
import { chunkUserDocumentText, rankDocumentChunks } from './rag/documents.js';
import { enforceAuthorityGuard } from './rag/responseGuard.js';
import { applyFailureStateNotice, getFailureStateInfo, resolveFailureState } from './rag/failureStates.js';
import { prependAnalysisDateHeader } from './rag/responsePolicy.js';
import {
  appendRunTraceEvent,
  buildAuditRunTraceContract,
  buildPromptHashes,
  completeRunTracePhase,
  finalizeRunTrace,
  persistRunTraceLog,
  startRunTrace,
  startRunTracePhase,
  summarizeRunTrace,
  validateAuditRunTraceContract,
} from './rag/auditTrace.js';
import { routeIntent } from './rag/router.js';
import { detectPromptInjection, isRcicRelatedQuery, sanitizeUserMessage } from './rag/security.js';
import {
  appendMessage,
  createDocument,
  dbEnabled,
  ensureSession,
  ensureUser,
  getRecentMessages,
  listHistory,
  listSessionDocumentChunks,
  listSessionDocuments,
  replaceDocumentChunks,
} from './db.js';
import { ingestPdiUrls, resolveIngestUrls } from './ingest/pdi/index.js';

dotenv.config({ override: true });

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, pineconeNamespace: process.env.PINECONE_NAMESPACE || null });
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

function normalizeDocTitle(value) {
  if (typeof value !== 'string') return 'Uploaded Document';
  const cleaned = value.trim();
  return cleaned || 'Uploaded Document';
}

function extractDateCandidate(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function resolveAnalysisDateContext(body = {}) {
  const explicitAsOf = extractDateCandidate(body?.asOf || body?.as_of);
  if (explicitAsOf) {
    return {
      analysisDateBasis: 'explicit_as_of',
      asOfDate: explicitAsOf,
    };
  }

  const applicationDate = extractDateCandidate(
    body?.applicationDate
    || body?.application_date
    || body?.lockInDate
    || body?.lock_in_date
  );
  if (applicationDate) {
    return {
      analysisDateBasis: 'application_date',
      asOfDate: applicationDate,
    };
  }

  return {
    analysisDateBasis: 'today',
    asOfDate: new Date().toISOString().slice(0, 10),
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

app.get('/api/documents', async (req, res) => {
  if (!dbEnabled()) {
    return res.json({ documents: [] });
  }

  const sessionId = req.query?.sessionId;
  if (!isUuid(sessionId)) {
    return res.status(400).json({ error: 'Valid sessionId is required' });
  }

  try {
    const externalAuthId = resolveExternalAuthId(req);
    const email = resolveUserEmail(req);
    const userId = await ensureUser({ externalAuthId, email });
    const documents = await listSessionDocuments({ sessionId, userId, limit: 100 });
    return res.json({ documents });
  } catch (error) {
    console.error('List documents error:', error);
    return res.status(500).json({ documents: [], error: 'Failed to list documents.' });
  }
});

app.post('/api/documents/text', async (req, res) => {
  if (!dbEnabled()) {
    return res.status(400).json({ error: 'Database is required for document uploads.' });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }

  const externalAuthId = resolveExternalAuthId(req);
  const email = resolveUserEmail(req);
  let sessionId = isUuid(req.body?.sessionId) ? req.body.sessionId : randomUUID();
  const title = normalizeDocTitle(req.body?.title);
  const sourceUrl = typeof req.body?.sourceUrl === 'string' && req.body.sourceUrl.trim()
    ? req.body.sourceUrl.trim()
    : null;
  const extractedJson = req.body?.extractedJson && typeof req.body.extractedJson === 'object'
    ? req.body.extractedJson
    : null;

  try {
    const userId = await ensureUser({ externalAuthId, email });
    const sessionTitle = title.slice(0, 80);
    let session = await ensureSession({ sessionId, userId, title: sessionTitle });
    if (!session) {
      sessionId = randomUUID();
      session = await ensureSession({ sessionId, userId, title: sessionTitle });
    }
    if (!session) {
      return res.status(500).json({ error: 'failed to initialize session' });
    }

    const doc = await createDocument({
      userId,
      sessionId,
      title,
      mimeType: 'text/plain',
      sourceUrl,
      extractedText: text,
      extractedJson,
      status: 'ready',
    });
    if (!doc) {
      return res.status(500).json({ error: 'failed to create document' });
    }

    const chunks = chunkUserDocumentText(text);
    const records = chunks.map((chunk) => ({
      chunk_index: chunk.chunk_index,
      text: chunk.text,
      metadata: {
        title,
        source_url: sourceUrl || undefined,
        source_type: 'user_document',
        start_char: chunk.start_char,
        end_char: chunk.end_char,
      },
    }));
    const chunkCount = await replaceDocumentChunks({ documentId: doc.id, chunks: records });

    return res.json({
      status: 'ok',
      sessionId,
      document: {
        id: doc.id,
        title: doc.title,
        sourceUrl: doc.source_url,
        status: doc.status,
      },
      chunkCount,
    });
  } catch (error) {
    console.error('Upload text document error:', error);
    return res.status(500).json({ error: 'Failed to process document text upload.' });
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
  const { analysisDateBasis, asOfDate } = resolveAnalysisDateContext(req.body || {});
  const auditTraceEnabled = boolFlag(process.env.AUDIT_TRACE_ENABLED, false);
  const auditTraceIncludeRedactedPrompt = boolFlag(process.env.AUDIT_TRACE_INCLUDE_REDACTED_PROMPT, false);
  const auditTracePersistLog = boolFlag(process.env.AUDIT_TRACE_PERSIST_LOG, true);
  const auditTraceSampleRate = Number(process.env.AUDIT_TRACE_SAMPLE_RATE || 1);
  const auditBudgets = {
    maxToolCalls: Number(process.env.RAG_MAX_TOOL_CALLS || 8),
    maxLiveFetches: Number(process.env.RAG_MAX_LIVE_FETCHES || 3),
    maxRetries: Number(process.env.RAG_MAX_RETRIES || 1),
  };
  let runTrace = null;
  const runtimeBudget = {
    maxToolCalls: Number(auditBudgets.maxToolCalls || 0),
    maxLiveFetches: Number(auditBudgets.maxLiveFetches || 0),
    usedToolCalls: 0,
    usedLiveFetches: 0,
  };
  if (auditTraceEnabled) {
    runTrace = startRunTrace({
      sessionId,
      message,
      analysisDateBasis,
      asOfDate,
      includeRedactedMessage: auditTraceIncludeRedactedPrompt,
      topK,
      budgets: auditBudgets,
      modelVersion: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      promptVersion: process.env.PROMPT_VERSION || 'v1',
      policyVersion: process.env.POLICY_VERSION || 'v1.0.0',
    });
    appendRunTraceEvent(runTrace, 'run_start', {
      sessionId,
      topK,
      debugEnabled,
    });
  }

  try {
    let userId = null;
    let history = [];
    if (dbEnabled()) {
      userId = await ensureUser({ externalAuthId, email });
      if (runTrace && userId) {
        runTrace.inputs = {
          ...(runTrace.inputs || {}),
          userId,
        };
      }
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
    appendRunTraceEvent(runTrace, 'input_safety', {
      detected: Boolean(promptSafety?.detected),
      rcicRelated,
      sanitized: sanitizedMessage !== message,
    });

    if (promptInjectionBlockingEnabled && promptSafety.detected && !rcicRelated) {
      const blockedText = 'I can only assist with RCIC-focused Canadian immigration research. Please rephrase your question without instruction-overrides.';
      const blockedResponseText = prependAnalysisDateHeader(blockedText, {
        analysisDateBasis,
        asOfDate,
      });
      const failureState = resolveFailureState({
        query: effectiveMessage,
        outOfScopeBlocked: true,
        budget: runtimeBudget,
      });
      const failureStateInfo = getFailureStateInfo(failureState);
      startRunTracePhase(runTrace, 'ROUTING', {
        prompt_injection_detected: true,
        rcic_related: rcicRelated,
      });
      completeRunTracePhase(runTrace, 'ROUTING', {
        status: 'FAILED',
        outputs: {
          blocked: true,
          reason: 'prompt_injection_out_of_scope',
        },
      });
      if (dbEnabled() && userId) {
        await appendMessage({
          sessionId,
          userId,
          role: 'assistant',
          content: blockedResponseText,
          citations: [],
        });
      }
      appendRunTraceEvent(runTrace, 'failure_state', {
        failureState,
      });
      finalizeRunTrace(runTrace, {
        status: 'ok',
        responseText: blockedResponseText,
        citations: [],
      });
      const auditTraceContract = runTrace ? buildAuditRunTraceContract(runTrace) : null;
      const auditTraceContractValidation = auditTraceContract
        ? validateAuditRunTraceContract(auditTraceContract)
        : null;
      if (runTrace && auditTraceEnabled && auditTracePersistLog) {
        persistRunTraceLog(runTrace, { sampleRate: auditTraceSampleRate });
      }
      return res.json({
        text: blockedResponseText,
        citations: [],
        sessionId,
        ...(debugEnabled
          ? {
              debug: {
                promptSafety,
                rcicRelated,
                analysisDate: {
                  basis: analysisDateBasis,
                  asOf: asOfDate,
                },
                failureState,
                failureStateInfo,
                auditTrace: summarizeRunTrace(runTrace),
                auditTraceContract,
                auditTraceContractValidation,
              },
            }
          : {}),
      });
    }

    startRunTracePhase(runTrace, 'RETRIEVAL', {
      top_k: topK,
      analysis_date_basis: analysisDateBasis,
      as_of_date: asOfDate,
    });
    runtimeBudget.usedToolCalls += 1;
    const grounding = await retrieveGrounding({ query: effectiveMessage, topK });
    completeRunTracePhase(runTrace, 'RETRIEVAL', {
      outputs: {
        pinecone_count: Array.isArray(grounding?.pinecone) ? grounding.pinecone.length : 0,
        tier_a_count: Number(grounding?.retrieval?.tiers?.binding?.count || 0),
        tier_b_count: Number(grounding?.retrieval?.tiers?.guidance?.count || 0),
        tier_c_count: Number(grounding?.retrieval?.tiers?.compare?.count || 0),
      },
    });

    startRunTracePhase(runTrace, 'ROUTING', {
      a2aj_enabled: a2ajEnabled,
      a2aj_case_law_enabled: a2ajCaseLawEnabled,
      a2aj_legislation_enabled: a2ajLegislationEnabled,
    });
    runtimeBudget.usedToolCalls += 1;
    const routeDecision = await routeIntent({
      message: effectiveMessage,
      a2ajEnabled,
      a2ajCaseLawEnabled,
      a2ajLegislationEnabled,
    });
    completeRunTracePhase(runTrace, 'ROUTING', {
      outputs: {
        use_case_law: Boolean(routeDecision?.useCaseLaw),
        use_legislation: Boolean(routeDecision?.useLegislation),
        route_limit: Number(routeDecision?.limit || 0),
      },
    });
    appendRunTraceEvent(runTrace, 'retrieval_complete', {
      queryHash: grounding?.retrieval?.queryHash || '',
      filters: grounding?.retrieval?.filters || null,
      tiers: grounding?.retrieval?.tiers || null,
      topSourceIds: (grounding?.retrieval?.topSourceIds || []).map((entry) => entry?.id).filter(Boolean),
      routeDecision,
    });

    let caseLawSources = [];
    let documentSources = [];
    let a2ajSearchCount = 0;
    let a2ajEnrichAttempted = false;
    if (a2ajEnabled && routeDecision.useCaseLaw && a2ajCaseLawEnabled) {
      try {
        runtimeBudget.usedToolCalls += 1;
        runtimeBudget.usedLiveFetches += 1;
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
        a2ajSearchCount = caseLawSources.length;
        a2ajEnrichAttempted = true;
        runtimeBudget.usedToolCalls += 1;
        caseLawSources = await a2ajEnrichCaseSources({
          sources: caseLawSources,
          query: effectiveMessage,
        });
      } catch (a2ajError) {
        console.warn('A2AJ retrieval failed; continuing with Pinecone-only grounding.', a2ajError?.message || a2ajError);
      }
    }
    if (caseLawSources.length > 0) {
      appendRunTraceEvent(runTrace, 'live_fetch_complete', {
        source: 'a2aj',
        canonicalUrl: 'a2aj://case-law',
        retrievedAt: new Date().toISOString(),
        contentHash: '',
        allowlistResult: 'allow',
      });
    }

    if (dbEnabled() && userId) {
      try {
        const documentRows = await listSessionDocumentChunks({
          sessionId,
          userId,
          limit: Number(process.env.DOCUMENT_CHUNK_POOL || 80),
        });
        documentSources = rankDocumentChunks({
          query: effectiveMessage,
          chunks: documentRows,
          topK: Number(process.env.DOCUMENT_TOP_K || 4),
        });
      } catch (docError) {
        console.warn('Document grounding failed; continuing without document sources.', docError?.message || docError);
      }
    }

    startRunTracePhase(runTrace, 'GROUNDING', {
      history_count: Array.isArray(history) ? history.length : 0,
      prior_case_law_count: caseLawSources.length,
      prior_document_count: documentSources.length,
    });
    const { system, user, citationMap } = buildPrompt({
      query: effectiveMessage,
      grounding: {
        ...grounding,
        caseLaw: caseLawSources,
        documents: documentSources,
      },
      history,
    });
    completeRunTracePhase(runTrace, 'GROUNDING', {
      outputs: {
        citation_map_size: Object.keys(citationMap || {}).length,
        case_law_count: caseLawSources.length,
        document_count: documentSources.length,
      },
    });
    appendRunTraceEvent(runTrace, 'prompt_built', buildPromptHashes({
      systemPrompt: system,
      userPrompt: user,
    }));

    startRunTracePhase(runTrace, 'GENERATION', {
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    });
    runtimeBudget.usedToolCalls += 1;
    const { text } = await groqAnswer({
      systemPrompt: system,
      userPrompt: user,
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    });
    completeRunTracePhase(runTrace, 'GENERATION', {
      outputs: {
        response_chars: String(text || '').length,
      },
    });

    startRunTracePhase(runTrace, 'RESPONSE_GUARD');
    const validatedText = validateCitationTokens(text, citationMap);
    const guardResult = enforceAuthorityGuard({
      text: validatedText,
      citationMap,
      retrieval: grounding?.retrieval,
    });
    const guardFailureState = resolveFailureState({
      query: effectiveMessage,
      guardIssues: guardResult.issues,
      retrieval: grounding?.retrieval,
      citations: [],
      budget: runtimeBudget,
    });
    completeRunTracePhase(runTrace, 'RESPONSE_GUARD', {
      status: guardFailureState !== 'NONE' ? 'PARTIAL' : 'SUCCESS',
      outputs: {
        guard_issue_count: Array.isArray(guardResult?.issues) ? guardResult.issues.length : 0,
        failure_state: guardFailureState,
      },
    });

    startRunTracePhase(runTrace, 'VALIDATION');
    const guardedText = validateCitationTokens(guardResult.text, citationMap);
    const citationIds = extractCitations(guardedText);
    const citations = citationIds
      .map((id) => buildCitationFromSource(id, citationMap[id] || {}))
      .filter(Boolean);
    const failureState = resolveFailureState({
      query: effectiveMessage,
      guardIssues: guardResult.issues,
      retrieval: grounding?.retrieval,
      citations,
      budget: runtimeBudget,
    });
    const failureStateInfo = getFailureStateInfo(failureState);
    const responseWithFailureNotice = applyFailureStateNotice(guardedText, failureState);
    const finalResponseText = prependAnalysisDateHeader(responseWithFailureNotice, {
      analysisDateBasis,
      asOfDate,
    });
    completeRunTracePhase(runTrace, 'VALIDATION', {
      outputs: {
        citation_id_count: citationIds.length,
        citation_count: citations.length,
      },
    });
    appendRunTraceEvent(runTrace, 'validation_complete', {
      guardIssues: guardResult.issues,
      citationIds,
      failureState,
    });
    if (failureState && failureState !== 'NONE') {
      appendRunTraceEvent(runTrace, 'failure_state', { failureState });
    }

    if (dbEnabled() && userId) {
      await appendMessage({
        sessionId,
        userId,
        role: 'assistant',
        content: finalResponseText,
        citations,
      });
    }
    finalizeRunTrace(runTrace, {
      status: 'ok',
      responseText: finalResponseText,
      citations,
    });
    const auditTraceContract = runTrace ? buildAuditRunTraceContract(runTrace) : null;
    const auditTraceContractValidation = auditTraceContract
      ? validateAuditRunTraceContract(auditTraceContract)
      : null;
    if (runTrace && auditTraceEnabled && auditTracePersistLog) {
      persistRunTraceLog(runTrace, { sampleRate: auditTraceSampleRate });
    }

    const payload = {
      text: finalResponseText,
      citations,
      sessionId,
      ...(debugEnabled
        ? {
            debug: {
              routeDecision,
              promptSafety,
              rcicRelated,
              analysisDate: {
                basis: analysisDateBasis,
                asOf: asOfDate,
              },
              failureState,
              failureStateInfo,
              budget: runtimeBudget,
              pineconeCount: Array.isArray(grounding.pinecone) ? grounding.pinecone.length : 0,
              caseLawCount: caseLawSources.length,
              documentCount: documentSources.length,
              retrieval: grounding?.retrieval || null,
              guardIssues: guardResult.issues,
              a2aj: {
                searchCount: a2ajSearchCount,
                enrichAttempted: a2ajEnrichAttempted,
                fetchTopK: Number(process.env.A2AJ_FETCH_DETAILS_TOP_K) || 3,
              },
              auditTrace: summarizeRunTrace(runTrace),
              auditTraceContract,
              auditTraceContractValidation,
            },
          }
        : {}),
    };

    return res.json(payload);
  } catch (error) {
    console.error('Chat error:', error);
    completeRunTracePhase(runTrace, 'VALIDATION', {
      status: 'FAILED',
      errors: [{ code: 'CHAT_ERROR', message: error?.message || 'Unhandled chat error' }],
    });
    finalizeRunTrace(runTrace, {
      status: 'error',
      responseText: '',
      citations: [],
      errorCode: 'CHAT_ERROR',
      errorMessage: error?.message || 'Unhandled chat error',
    });
    const auditTraceContract = runTrace ? buildAuditRunTraceContract(runTrace) : null;
    const auditTraceContractValidation = auditTraceContract
      ? validateAuditRunTraceContract(auditTraceContract)
      : null;
    const failureState = 'INSUFFICIENT_EVIDENCE';
    const failureStateInfo = getFailureStateInfo(failureState);
    appendRunTraceEvent(runTrace, 'failure_state', { failureState });
    if (runTrace && auditTraceEnabled && auditTracePersistLog) {
      persistRunTraceLog(runTrace, { sampleRate: auditTraceSampleRate });
    }
    const errorText = prependAnalysisDateHeader('Server error while generating response.', {
      analysisDateBasis,
      asOfDate,
    });
    return res.status(500).json({
      text: errorText,
      citations: [],
      sessionId,
      ...(debugEnabled
        ? {
            debug: {
              analysisDate: {
                basis: analysisDateBasis,
                asOf: asOfDate,
              },
              failureState,
              failureStateInfo,
              budget: runtimeBudget,
              auditTrace: summarizeRunTrace(runTrace),
              auditTraceContract,
              auditTraceContractValidation,
            },
          }
        : {}),
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
  console.log(`PINECONE_NAMESPACE=${process.env.PINECONE_NAMESPACE || '<unset>'}`);
});
