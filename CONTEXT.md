# Project Context

Last updated: 2026-02-12

## Snapshot
- Name: `rcic-case-law-assistant`
- Stack: Vite + React frontend, Node/Express backend
- Domain: RCIC-focused legal research assistant (Canadian immigration)
- Core retrieval/generation: Pinecone grounding + Groq answer generation
- Case-law integration: A2AJ REST (server-side orchestration, no model MCP tool-calling in Groq requests)

## Current Architecture (Important)
- Chat endpoint: `POST /api/chat`
- Retrieval path:
  1. Pinecone retrieval always
  2. Intent routing (`server/rag/router.js`) decides A2AJ use
  3. A2AJ decision search/fetch enrichment when enabled
- Prompt grounding:
  - Pinecone sources labeled `P1..Pn`
  - A2AJ sources labeled `C1..Cn`
- Citation safety:
  - model output tokens validated against citation map (`validateCitationTokens`)
  - invalid `[P#]/[C#]` tokens removed before response
- UI:
  - inline citation tokens in chat are clickable and open citation popup
  - Sources panel renders from `citations[]` returned by backend

## Runtime Endpoints
- `GET /api/health`
- `GET /api/history` (DB-backed if `DATABASE_URL` configured)
- `POST /api/chat`
- `POST /api/ingest/pdi` (URL -> parse -> chunk -> embed -> upsert)
- `POST /api/ingest` is placeholder (`not implemented`)

## Database Status
Implemented DB integration (when `DATABASE_URL` is set):
- `users`
- `sessions`
- `messages` (includes `citations` JSONB)

Server behavior:
- If DB configured, user/session/messages are persisted.
- If DB not configured, app still works in stateless mode.

## Auth Status
- Neon auth identity hooks are wired in frontend API client (`lib/neonAuth.ts`, `lib/api.ts`).
- App can operate with auth bypass/dev identity depending on env and current setup.
- Prior 403 issues were related to callback/allowed URL config; auth can be bypassed for dev.

## Citation System Status
Implemented and active:
- Prompt citation map creation (`server/rag/grounding.js`)
- Citation token extraction + validation (`extractCitations`, `validateCitationTokens`)
- Citation object mapping in API response (`buildCitationFromSource` in `server/index.js`)
- Inline clickable citations in assistant messages (`components/chat/MessageBubble.tsx`)
- Sources panel + citation popup (`components/chat/SourcesPanel.tsx`, `pages/ChatPage.tsx`)
- Citation persistence/reload through DB history (`server/db.js`, `lib/api.ts`)

Detailed deep-dive doc:
- `CITATION_SYSTEM.md`

## A2AJ Integration Status
Current approach is REST-only server orchestration:
- Search endpoint usage via `server/clients/a2aj.js`
- Detail fetch enrichment via `a2ajGetDecision` / `a2ajEnrichCaseSources`
- Non-fatal fallback: if A2AJ fails, chat still returns Pinecone-grounded response

Known behavior observed:
- API path mismatch/debug iterations were resolved toward `/search` and `/fetch` behavior.
- Quality now depends on top-result detail-fetch policy and snippet extraction quality.

## Prompt Injection / Scope Guard
Implemented in `server/rag/security.js`:
- prompt injection pattern detection
- sanitization of user text
- RCIC-domain relevance gating
- optional block behavior via env flag

## PDI Ingestion Pipeline Status (`server/ingest/pdi/*`)
Implemented modules:
- fetch, parse, sectionize, chunk, embed, upsert
- endpoint: `POST /api/ingest/pdi`
- tests passing: `npm run test:server`

Chunking behavior:
- section-based chunking with overlap
- table boundary handling to avoid cutting table rows
- metadata includes heading path, anchor, chunk indices, source URL/title/last updated

## Scraper Status (`scripts/scraper/*`)
- Recursive crawler implemented with dedupe + state resume
- Seed list: `scripts/scraper/input_links.md`
- Output dir: `scripts/scraper/ircc_data_clean`

Latest completed crawl summary:
- allowed seed URLs visited: 287/287
- saved markdown files: 284
- remaining queue: 0
- known scrape failures persisted in manifest for a small subset

Cleanup completed:
- canonical output retained in `scripts/scraper/ircc_data_clean` (currently populated with 284 markdown files)
- trial directories `ircc_data_clean_try*` are present and can be kept for comparison or cleaned later

## Current Phase Focus
Current repo focus remains Phase 1 + ingestion hardening:
- Chat grounding/citations currently support `P#` and `C#` tokens only.
- Active ingestion work is in `server/ingest/pdi/*`, `scripts/ingest_md/ingest_md.py`, and `scripts/ingest_pdf/*`.
- DB persistence currently covers `users`, `sessions`, and `messages` only.

Phase 2 document-intelligence items are not present in this checkout (as of 2026-02-12):
- no `server/db/migrations/phase2_documents.sql`
- no `server/rag/documents.js`
- no `POST /api/documents/text` or `GET /api/documents` endpoints
- no `D#` citation token handling in grounding/extraction
- no `server/ingest/pdi/__tests__/documents.test.js`

Phase 1 delegation remains active in parallel:
- `PHASE1_DELEGATION.md`

## Latest Debug Update (2026-02-12)
- Canonical markdown dataset was restored into `scripts/scraper/ircc_data_clean` from Git commit `c1f0b3eadfee6a1be4d6175e5dd65f19bcc7288c`.
  - current markdown count in canonical directory: `284` files.
- Markdown ingestion pipeline (`scripts/ingest_md/ingest_md.py`) was fixed for `EMBEDDING_PROVIDER=pinecone`:
  - non-dry runs now always call real embedding (no dummy-vector fallback).
  - this resolved prior dimension mismatch failures.
- Verified one-file end-to-end upsert success:
  - `python scripts/ingest_md/ingest_md.py --directory scripts/scraper/ircc_data_clean --max-files 1`
  - summary: `Files processed: 1`, `Chunks embedded: 11`, `Vectors upserted: 11`.
- Added resumability controls to markdown ingestion:
  - `--no-delete-existing-source`
  - `--skip-existing-ids`
- New target namespace selected for refreshed markdown ingestion:
  - `ircc-guidance-v1-20260212`
  - full run started successfully but was user-interrupted before completion.
- Added delegation/runbook doc:
  - `MARKDOWN_UPSERT_PIPELINE_DELEGATION.md`
- Added PDF ingestion MVP scaffold:
  - `scripts/ingest_pdf/ingest_pdf.py` + modular helpers (`extract`, `normalize`, `structure`, `chunk`, `embed`, `upsert`, `state`, `schemas`)
  - supports dry-run, state tracking, `--no-delete-existing-source`, `--skip-existing-ids`
  - OCR flag wired as placeholder (`--enable-ocr`) for later integration.

## Key Files (High Value)
- `server/index.js`
- `server/rag/grounding.js`
- `server/rag/router.js`
- `server/rag/security.js`
- `server/clients/a2aj.js`
- `server/clients/pinecone.js`
- `server/db.js`
- `components/chat/MessageBubble.tsx`
- `components/chat/SourcesPanel.tsx`
- `pages/ChatPage.tsx`
- `server/ingest/pdi/index.js`
- `scripts/ingest_md/ingest_md.py`
- `scripts/ingest_pdf/ingest_pdf.py`
- `scripts/ingest_pdf/extract.py`
- `scripts/ingest_pdf/chunk.py`
- `scripts/ingest_pdf/upsert.py`
- `scripts/scraper/scrape.py`
- `MARKDOWN_UPSERT_PIPELINE_DELEGATION.md`

## Commands
- Install: `npm install`
- Backend: `npm run dev:server`
- Frontend: `npm run dev`
- Server tests: `npm run test:server`
- Markdown one-file ingestion:
  - `python scripts/ingest_md/ingest_md.py --directory scripts/scraper/ircc_data_clean --max-files 1`
- Markdown resumable ingestion (no delete + skip existing IDs):
  - `python scripts/ingest_md/ingest_md.py --directory scripts/scraper/ircc_data_clean --namespace ircc-guidance-v1-20260212 --no-delete-existing-source --skip-existing-ids`
- PDF dry-run ingestion (example):
  - `python scripts/ingest_pdf/ingest_pdf.py --directory scripts/pdfs --namespace ircc-pdf-v1-20260212 --max-files 1 --dry-run`
- Scraper (resume):
  - `python -u scripts/scraper/scrape.py --input-links-md /workspaces/legalnew/scripts/scraper/input_links.md --output-dir scripts/scraper/ircc_data_clean`

## Environment Variables (Current-Relevant)
Core:
- `GROQ_API_KEY`, `GROQ_MODEL`, `ROUTER_MODEL`
- `PINECONE_API_KEY`, `PINECONE_INDEX_HOST`, `PINECONE_NAMESPACE`
- `RETRIEVAL_TOP_K`
- `DATABASE_URL`

A2AJ:
- `A2AJ_ENABLED`
- `A2AJ_CASELAW_ENABLED`
- `A2AJ_LEGISLATION_ENABLED`
- `A2AJ_API_BASE`
- `A2AJ_API_KEY`
- `A2AJ_TIMEOUT_MS`
- `A2AJ_TOP_K`
- `A2AJ_FETCH_DETAILS_TOP_K`

Security/debug:
- `PROMPT_INJECTION_BLOCK_ENABLED`
- `DEBUG_MODE`

Ingestion:
- `EMBEDDING_MODEL`, `EMBEDDING_DIM`, `EMBEDDING_BASE_URL`
- `EMBEDDING_PROVIDER`, `PINECONE_API_VERSION`
- `PDI_EMBED_BATCH_SIZE`, `PDI_EMBED_CONCURRENCY`, retry/backoff envs
- `PDI_UPSERT_BATCH_SIZE`, `PDI_UPSERT_MAX_REQUEST_BYTES`, retry/backoff envs

## Open Risks
- A2AJ latency and excerpt quality variance can still affect answer depth.
- Citation contract has legacy + new fields; keep backward compatibility until UI is fully simplified.
- Scraper outputs are large and currently mixed with runtime manifests; consider a cleaner artifacts policy for future commits.
