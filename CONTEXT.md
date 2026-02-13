# Project Context

Last updated: 2026-02-13

## Snapshot
- Name: `rcic-case-law-assistant`
- Stack: Vite + React frontend, Node/Express backend
- Domain: RCIC-focused legal research assistant (Canadian immigration)
- Core retrieval/generation: Pinecone grounding + Groq answer generation
- Case-law integration: A2AJ REST (server-side orchestration, no model MCP tool-calling in Groq requests)

## Current Architecture (Important)
- Chat endpoint: `POST /api/chat`
- Retrieval path:
  1. Tiered Pinecone retrieval (`server/rag/grounding.js`) with query profiling and metadata filters
  2. Intent routing (`server/rag/router.js`) decides A2AJ use
  3. A2AJ decision search/fetch enrichment when enabled
- Prompt grounding:
  - Pinecone sources labeled `P1..Pn` (Tier A/Tier B combined in stable order)
  - A2AJ sources labeled `C1..Cn`
  - Uploaded document sources labeled `D1..Dn`
- Citation safety:
  - model output tokens validated against citation map (`validateCitationTokens`)
  - invalid `[P#]/[C#]` tokens removed before response
  - post-generation hierarchy guard (`server/rag/responseGuard.js`) adds warnings when binding claims lack binding citations
- UI:
  - inline citation tokens in chat are clickable and open citation popup
  - Sources panel renders from `citations[]` returned by backend

## Runtime Endpoints
- `GET /api/health`
- `GET /api/history` (DB-backed if `DATABASE_URL` configured)
- `GET /api/documents` (DB-backed when enabled)
- `POST /api/chat`
- `POST /api/documents/text` (DB-backed when enabled)
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
- Canonical metadata passthrough on citations (`authorityLevel`, `docFamily`, `instrument`, `jurisdiction`, `effectiveDate`, etc.)

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
Current repo focus is metadata-governed retrieval hardening:
- Tiered Pinecone retrieval with explicit filter/debug artifacts (`server/rag/grounding.js`)
- Response hierarchy guard to reduce policy-as-law drift (`server/rag/responseGuard.js`)
- Ingestion metadata enrichment for markdown/pdf/pdi pipelines (canonical authority/doc_family/instrument/jurisdiction + optional fields)
- Document endpoints and `D#` citations are present and active in chat flow
- DB persistence currently covers `users`, `sessions`, `messages`, and session-scoped document/chunk grounding
- Phase 0 contract freeze and control-plane scaffolding is now active for agentic RCIC architecture:
  - roadmap: `docs/RCIC_AGENTIC_RESEARCH_ROADMAP.md`
  - parallel delegation: `docs/PHASE0_PARALLEL_EXECUTION_DELEGATION.md`

Phase 1 delegation remains active in parallel:
- `PHASE1_DELEGATION.md`

## Phase 0 Junior Execution Details (Important)
Junior-first policy for Phase 0:
- Junior owns non-complex deterministic work by default (target 75-85% of Phase 0 implementation).
- Senior handles only high-complexity/high-risk control-plane tasks.

Primary docs junior must follow:
- `docs/PHASE0_PARALLEL_EXECUTION_DELEGATION.md`
- `docs/RCIC_AGENTIC_RESEARCH_ROADMAP.md`

Junior track assignments (J1-J7):
- J1 Contracts pack:
  - create `contracts/v1/*.schema.json`
  - create `contracts/v1/examples/*.json`
- J2 Source policy:
  - create `config/source_policy.v1.json`
  - add allowlist/blocklist tests
- J3 Eval harness scaffold:
  - create `eval/gold/gold_set_template.jsonl`
  - create `eval/run_eval.(js|ts|py)`
- J4 CI + validation tooling:
  - schema/example validation runner
  - CI job + report artifact output
- J5 Failure-state test matrix:
  - create `eval/failure_state_matrix.json`
  - add stubbed tests per failure code
- J6 Docs/runbooks:
  - create `docs/phase0_contracts.md`
  - create `docs/phase0_testplan.md`
  - create `docs/phase0_runbook.md`
- J7 Gold-set expansion:
  - expand starter gold set to 30-40 entries
  - Phase 0 assertions are scope/failure/doc-family checks (not answer-quality grading)

Contract/index requirements for junior:
- maintain single source of truth index:
  - `contracts/v1/INDEX.md` with version `v1.0.0`, schema list, required fields, examples
- canonical ID format:
  - `doc_id = sha256(canonical_url)` (64 hex)
  - `content_hash_prefix = first 12 hex`
  - `artifact_id = doc_id + ":" + content_hash_prefix`
  - `chunk_id = artifact_id + ":" + chunk_index`
  - `run_id = ulid()` (26 chars)

Temporal requiredness (Phase 0 contracts):
- required always: `observed_at`, `ingested_at`, `retrieved_at`
- optional: `published_at`, `effective_from`, `effective_to`
- required-if (best effort): for `{MI, PUBLIC_POLICY, OINP, BC_PNP, AAIP}`, include `effective_from`; `effective_to` nullable

Junior boundaries (must not cross without approval):
- Do not modify runtime orchestration/failure semantics in app server code.
- Do not change retrieval behavior in `server/rag/*` during J-tracks.
- Do not change policy semantics in roadmap docs.
- Keep each PR scoped to a single J-track.
- Junior PRs must not modify `server/**` runtime code.
- Exception: tests or config-loading hooks behind feature flags with explicit senior approval.

Phase 0 validator scope (junior scaffold):
- include: schema checks, authority/modality compatibility, allowlist checks, binding-claim source checks on stub payloads
- exclude: semantic quote verification by LLM (Phase 1+)

Junior daily status format (required):
- `Track:`
- `PR:`
- `Tests:`
- `Blocked by:`
- `Next:`

Merge order for minimal conflicts:
1. J1
2. J2
3. J4
4. J3
5. J5
6. J6
7. J7
8. Senior integration tracks

Phase 0 acceptance checks junior should run:
- `npm run test:server`
- eval runner:
  - `node eval/run_eval.js` or `python eval/run_eval.py`
- schema/example validation script from J4 tooling

## Latest Debug Update (2026-02-13)
- Added junior delegation runbook:
  - `LEGAL_RAG_JUNIOR_PARALLEL_DELEGATION.md`
- Added Phase 0 parallel delegation runbook:
  - `docs/PHASE0_PARALLEL_EXECUTION_DELEGATION.md`
- Added/updated Phase 0 architecture roadmap with execution controls:
  - `docs/RCIC_AGENTIC_RESEARCH_ROADMAP.md`
  - includes constrained executor contract, budgets, failure-state set, temporal semantics, claim-ledger hard gates, and Phase 1 CI-eval requirement
- Started Senior Track S3 (audit trace wiring plan):
  - `docs/PHASE0_S3_AUDIT_TRACE_WIRING_PLAN.md`
  - defines `/api/chat` trace insertion points, payload contract mapping, redaction defaults, feature flags, persistence strategy, and acceptance tests
- Started S3 runtime scaffold (feature-flagged, non-blocking):
  - new utility: `server/rag/auditTrace.js`
  - `/api/chat` now emits structured trace events/summaries when `AUDIT_TRACE_ENABLED=true`
  - trace summary is included under `debug.auditTrace` in chat responses when debug is enabled
- Advanced S3 runtime wiring completed:
  - phase-level trace capture added for `RETRIEVAL`, `ROUTING`, `GROUNDING`, `GENERATION`, `VALIDATION`, `RESPONSE_GUARD`
  - trace contract adapter + validator added:
    - `buildAuditRunTraceContract(...)`
    - `validateAuditRunTraceContract(...)`
  - `/api/chat` debug payload now includes:
    - `debug.auditTraceContract`
    - `debug.auditTraceContractValidation`
  - optional structured trace logging enabled via env flags:
    - `AUDIT_TRACE_PERSIST_LOG`
    - `AUDIT_TRACE_SAMPLE_RATE`
  - analysis date context now supports:
    - `today`
    - `explicit_as_of` (`asOf`/`as_of`)
    - `application_date` (`applicationDate`/`lockInDate`)
  - added unit coverage: `server/rag/__tests__/auditTrace.test.js`
- Started S4 arbitration/sign-off integration:
  - added runtime failure-state resolver:
    - `server/rag/failureStates.js`
  - `/api/chat` failure-state assignment now uses deterministic resolver with precedence:
    - `OUT_OF_SCOPE_SOURCE` -> `BUDGET_EXCEEDED` -> `CITATION_MISMATCH` -> `STALE_VOLATILE_SOURCE` -> `NO_BINDING_AUTHORITY` -> `INSUFFICIENT_EVIDENCE` -> `INSUFFICIENT_FACTS` -> `NONE`
  - runtime budget counters (`usedToolCalls`, `usedLiveFetches`) are now tracked and surfaced in debug payload
  - debug payload now includes:
    - `failureState`
    - `failureStateInfo`
    - `budget`
  - added unit coverage:
    - `server/rag/__tests__/failureStates.test.js`
  - sign-off memo added:
    - `docs/PHASE0_SIGNOFF.md`
    - decision: `GO (Conditional)` for Phase 0 completion
- Junior progress status:
  - J2 completed: source policy config + allowlist/blocklist tests
  - J3 completed: eval harness scaffold (`eval/run_eval.js` + gold template)
  - J4 completed: CI workflow for Phase 0 schema/source-policy checks
  - J5 completed: failure-state matrix + deterministic tests
  - J6 completed: Phase 0 contracts/testplan/runbook docs
  - J7 completed: gold set expanded to 39 entries
- Delegation policy updated to junior-first:
  - junior assigned J1-J7 tracks (contracts, config, eval/CI scaffolding, runbooks, gold set)
  - senior limited to complex control-plane arbitration and policy/runtime guard semantics
- Junior Track B/C was reviewed and normalized to canonical schema values:
  - validator updated in `scripts/ingest_md/validate_namespace.py`
  - mapping contract corrected in `docs/LEGAL_METADATA_MAPPING.md`
  - validation pass (2026-02-13): `npm run test:server` passed, Python compile checks passed for validator/metadata modules
  - runtime note: `validate_namespace.py` requires Python package `pinecone` in local env to execute namespace scans
- Senior stream retrieval updates:
  - tiered retrieval/query profiling/filter reporting in `server/rag/grounding.js`
  - hierarchy post-guard in `server/rag/responseGuard.js`
  - debug payload now includes `retrieval` and `guardIssues` in `/api/chat`
- Senior Track A metadata emission added:
  - markdown: `scripts/ingest_md/legal_metadata.py` + wired in `scripts/ingest_md/ingest_md.py`
  - pdf: `scripts/ingest_pdf/legal_metadata.py` + wired in `scripts/ingest_pdf/chunk.py`
  - pdi: canonical metadata builder in `server/ingest/pdi/index.js`
  - section ID normalization corrected for nested citations:
    - `A40(1)(a)` now maps to `IRPA_A40_1a`
    - `R200(1)(c)` maps to `IRPR_200_1c` while `R179(b)` remains `IRPR_179b`
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
- `server/rag/responseGuard.js`
- `server/rag/auditTrace.js`
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
- `scripts/ingest_md/legal_metadata.py`
- `scripts/ingest_md/validate_namespace.py`
- `scripts/ingest_pdf/ingest_pdf.py`
- `scripts/ingest_pdf/extract.py`
- `scripts/ingest_pdf/chunk.py`
- `scripts/ingest_pdf/legal_metadata.py`
- `scripts/ingest_pdf/upsert.py`
- `scripts/scraper/scrape.py`
- `MARKDOWN_UPSERT_PIPELINE_DELEGATION.md`
- `LEGAL_RAG_JUNIOR_PARALLEL_DELEGATION.md`
- `docs/LEGAL_METADATA_MAPPING.md`
- `docs/RCIC_AGENTIC_RESEARCH_ROADMAP.md`
- `docs/PHASE0_PARALLEL_EXECUTION_DELEGATION.md`
- `docs/PHASE0_S3_AUDIT_TRACE_WIRING_PLAN.md`

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
- `RAG_TIERED_RETRIEVAL_ENABLED`
- `RAG_TOP_K_BINDING`
- `RAG_TOP_K_GUIDANCE`
- `RAG_NO_SILENT_FALLBACK_ENABLED`
- `AUDIT_TRACE_ENABLED`
- `AUDIT_TRACE_INCLUDE_REDACTED_PROMPT`
- `RAG_MAX_TOOL_CALLS`
- `RAG_MAX_LIVE_FETCHES`
- `RAG_MAX_RETRIES`

Ingestion:
- `EMBEDDING_MODEL`, `EMBEDDING_DIM`, `EMBEDDING_BASE_URL`
- `EMBEDDING_PROVIDER`, `PINECONE_API_VERSION`
- `PDI_EMBED_BATCH_SIZE`, `PDI_EMBED_CONCURRENCY`, retry/backoff envs
- `PDI_UPSERT_BATCH_SIZE`, `PDI_UPSERT_MAX_REQUEST_BYTES`, retry/backoff envs

## Open Risks
- A2AJ latency and excerpt quality variance can still affect answer depth.
- Citation contract has legacy + new fields; keep backward compatibility until UI is fully simplified.
- Scraper outputs are large and currently mixed with runtime manifests; consider a cleaner artifacts policy for future commits.
