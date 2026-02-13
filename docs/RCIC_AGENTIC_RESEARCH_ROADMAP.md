# RCIC Agentic Research Roadmap

Last updated: 2026-02-13  
Status: Draft for implementation

## 1) Objective
Build an enterprise-grade, agentic Canadian immigration legal research system that is:
- legally hierarchical (binding vs guidance vs interpretive)
- temporally correct (historical + current-state answers)
- auditable (claim-level evidence and reproducible run traces)
- operationally safe for RCIC practice

## 2) Guiding Principles
- Evidence-first: no final answer without an Evidence Bundle.
- Deterministic control plane: state-machine execution, bounded tool budgets.
- No silent fallback: explicitly report missing binding authority.
- Temporal governance: model publication, effectiveness, and observation separately.
- Verifiability over fluency: block or rewrite output on failed claim validation.
- Explicit date basis: every answer must state whether analysis is `as_of=today` or `as_of=application_date`.

## 3) Architecture Decisions (Target)
- Orchestration: Hierarchical state machine (LangGraph) with mandatory legal guard nodes.
- Retrieval: Hybrid router with deterministic tiering.
- Ingestion: Source-specific pipeline (IRCC web, PDF tables, case law APIs).
- Time model: Bi-temporal artifacts with explicit effective windows.
- Trust: Claim Ledger + verifier gate + immutable audit package.

### 3.1 Execution Control Contract (Mandatory)
Orchestrator:
- constrained LangGraph executor (no open-loop autonomous retries)

Budgets (default):
- `MAX_TOOL_CALLS=8` (up to `10` for complex flows)
- `MAX_LIVE_FETCHES=3`
- `MAX_RETRIES=1`

Mandatory node order:
- `classify -> plan -> retrieve_binding -> retrieve_guidance -> validate -> (conditional) live_fetch -> validate -> draft -> validate`

Failure states returned to caller:

| Code | Meaning |
|---|---|
| `NO_BINDING_AUTHORITY` | No binding authority found for a binding claim. |
| `STALE_VOLATILE_SOURCE` | Volatile source is outdated or cannot be refreshed. |
| `CITATION_MISMATCH` | Claims do not map to retrieved, allowed evidence. |
| `OUT_OF_SCOPE_SOURCE` | Source host/path violates allowlist policy. |
| `BUDGET_EXCEEDED` | Tool/live-fetch budget was exceeded before safe completion. |
| `INSUFFICIENT_FACTS` | User query lacks enough case facts for a reliable answer. |
| `INSUFFICIENT_EVIDENCE` | Available evidence is insufficient for a safe conclusion. |

### 3.2 Case Law Governance
- Treat case law as interpretive authority by default, not binding truth.
- Force explicit citation labels: `controlling` or `persuasive`.
- Rank with:
  - court-level weighting (SCC > FCA > FC, then tribunal-level)
  - recency weighting
  - topic relevance weighting (for domain-specific issue matching)
- Require quoted proposition text for every cited case claim.

## 4) Data Contracts (Must Freeze Early)
### 4.1 Canonical metadata fields
Required:
- `authority_level`, `doc_family`, `instrument`, `jurisdiction`
- `source_url`, `title`, `content_hash`
- `observed_at`, `ingested_at`

Temporal:
- required always:
  - `observed_at`: first time this artifact version was seen by system
  - `ingested_at`: storage/processing timestamp in the platform
  - `retrieved_at`: per-run retrieval/fetch timestamp (audit/event layer)
- optional:
  - `published_at`: when the publisher posts the artifact (if known)
  - `effective_from`: when the legal/policy rule starts to apply
  - `effective_to`: when applicability ends (nullable)
- required-if (best effort):
  - for `doc_family` in `{MI, PUBLIC_POLICY, OINP, BC_PNP, AAIP}`, include `effective_from`; `effective_to` nullable

Time-travel rule:
- Resolve `as_of_date` using `effective_from/effective_to` first.
- If effective dates are missing, fallback to `observed_at`.
- Persist chosen resolution basis in run diagnostics.

Optional:
- `section_id`, `program_stream`, `noc_code`, `teer`, `table_type`

### 4.2 Claim Ledger schema (v1)
Each claim record:
- `claim_id`
- `claim_text`
- `modality` (`binding` | `guidance` | `interpretive` | `factual`)
- `assertion_type` (`requirement` | `discretion_factor` | `definition` | `deadline` | `fee` | `threshold`)
- `source_id`
- `source_hash`
- `canonical_url`
- `authority_level`
- `quote_span` (offsets or paragraph IDs)
- `quote_text` (short excerpt, max ~25 words)
- `in_force_check` (`as_of_date`, `result`)
- `confidence` (`low` | `medium` | `high`)
- `verified` (boolean)
- `failure_reason` (nullable)

Hard gate:
- any `binding` claim without a binding authority source and quote span must fail validation.

### 4.3 Canonical Identifiers (Deterministic)
- `doc_id = sha256(canonical_url)` (64 hex chars)
- `content_hash = sha256(content)` (64 hex chars)
- `content_hash_prefix = first 12 hex chars`
- `artifact_id = doc_id + ":" + content_hash_prefix`
- `chunk_id = artifact_id + ":" + chunk_index`
- `run_id = ulid()` (26 chars)

Contract index requirement:
- every contract version includes a single source of truth file:
  - `contracts/v1/INDEX.md`
  - includes version (`v1.0.0`), schema list, required fields, example files

## 5) Workstreams (Parallel)
1. Orchestration and state machine
- LangGraph graph, node contracts, stop states, retries, budgets.

2. Retrieval and routing
- Tier A/B/C retrieval policy, filter contracts, fallback messaging, source allowlists.

3. Data factory and ingestion
- IRCC diff detection, PDF table parsing, case law search/fetch integration.

4. Temporal governance
- bi-temporal schema, as-of querying, lock-in-date query mode.

5. Trust and audit
- claim extraction, verification gate, audit package generation, immutable run IDs.

6. Eval and release
- regression suite, hierarchy tests, citation integrity tests, volatility freshness tests.

## 6) Phase Plan

### Phase 0 (Weeks 1-2): Control Plane + Contract Freeze
Scope:
- finalize schemas for metadata, Evidence Bundle, Claim Ledger, ValidationResult
- define domain/path allowlists and blocked domains
- define failure states and no-silent-fallback policy
- define analysis-date policy (`as_of=today` default + lock-in-date switch rule)
- define PII classification and retention controls
- execute parallel ownership split per `docs/PHASE0_PARALLEL_EXECUTION_DELEGATION.md`

Deliverables:
- schema docs and JSON examples
- retrieval policy spec (Tier A/B/C + top_k + fallback behavior)
- run-trace spec for auditability
- evaluation harness scaffolding and initial gold-set template
- versioned contract index (`contracts/v1/INDEX.md`)

Exit criteria:
- all contracts versioned and reviewed
- baseline integration tests passing in CI

### Phase 1 (Weeks 3-4): Deterministic Retrieval Core
Scope:
- implement deterministic executor in app runtime with budgets/failure states
- enforce tiered retrieval with authority-aware filters
- return debug payload per request
- run eval harness in CI for ingestion/routing/prompt changes
- deliver lean v1 dependencies only

Deliverables:
- retrieval executor (`classify -> plan -> retrieve_binding -> retrieve_guidance -> validate -> draft -> validate`)
- debug payload with filters, source mix, source IDs, scores
- hard error on missing binding support for binding claims
- lean baseline:
  - current scraper + canonical URL normalization
  - stable corpus retrieval (IRPA/IRPR)
  - PDI live fetch for volatile checks
  - claim ledger validator + audit record write

Exit criteria:
- no blended retrieval for test intents
- repeatability within fixed settings for benchmark queries
- gold-set CI gate active

### Phase 2 (Weeks 5-8): Data Factory + Volatility
Scope:
- IRCC/PDI change detection agent (hash + diff + archive)
- volatile registry with version windows
- live fetch adapter with scoped search and extraction fallback

Deliverables:
- scheduled diff pipeline
- versioned artifact store (`effective_from/effective_to`)
- live fetch toolchain (`search_official`, `fetch_authority`, extraction)
- optional dependency expansion only where metrics justify:
  - Firecrawl/Tavily/LlamaParse by measured uplift on target suites

Exit criteria:
- detected changes create new versions without overwriting old artifacts
- volatile answers include `source_url + fetched_at + quote`

### Phase 3 (Weeks 9-12): Claims Ledger + Audit Package
Scope:
- claim extraction and grounding
- verifier gate and rewrite loop
- audit package export

Deliverables:
- claim ledger generator
- verifier node with hard fail conditions
- signed/hashed run package: prompt, trace, context snapshot, ledger, output

Exit criteria:
- hallucinated legal citations blocked in evaluation harness
- reproducible run package for sampled sessions

### Phase 4 (Weeks 13-16): Production Hardening
Scope:
- security/privacy hardening for uploaded case files
- performance tuning and cost controls
- human-in-the-loop interrupts for high-risk recommendations

Deliverables:
- PII handling policy and retention controls
- latency budget enforcement and caching strategy
- RCIC review UI for evidence and claim verification

Exit criteria:
- SLOs achieved for latency and reliability
- compliance checks passed for audit readiness

## 7) Evaluation Harness (Must Run in CI)
Start phase:
- active no later than Phase 1 (not deferred to hardening)

Core suites:
- hierarchy enforcement: policy never treated as binding law
- routing enforcement: allowed doc families by intent
- temporal correctness: “as-of date” answers match historical versions
- citation integrity: all claims map to valid retrieved sources
- volatility freshness: live-required intents fail if stale

Phase 0 validator scope:
- include:
  - schema conformance checks
  - authority/modality compatibility checks
  - allowlist/out-of-scope checks
  - binding-claim requires binding-source checks (stub payloads)
- exclude:
  - semantic quote-verification by LLM (Phase 1+)

Minimum regression set:
- TRV intent and overstay
- study permit financial requirement (volatile)
- EE/MI compare queries
- PNP grid scoring lookup
- NOC/TEER lookup
- LICO/MNI year-specific lookup

Gold set size:
- initial 30-60 queries spanning TRV/study/work/EE and hierarchy edge cases

Phase 0 pass semantics:
- validate URL scope decisions
- validate expected `failure_state` enums
- validate expected `doc_family` allow/disallow from stub retrieval outputs
- do not grade freeform answer correctness in Phase 0

CI trigger matrix:
- ingestion changes
- routing changes
- prompt/policy changes
- model-version changes

## 8) Observability and Run Diagnostics
Per request store:
- `run_id`, `query_hash`, orchestration path
- retrieval filters, tier counts, top source IDs
- live fetch URLs, `fetched_at`, `content_hash`
- claim ledger results and validator outcomes

Operational dashboards:
- stale-source rate for volatile families
- validator fail rate by reason
- unresolved “no binding authority” rate
- average tool calls and token/cost per run

## 9) Operational Security & PII Controls (First-Class)
- classify uploads by PII sensitivity tier
- define retention by tenant/workspace and legal policy
- encrypt artifacts at rest and in transit
- ensure immutable audit packages can be stored as redacted evidence:
  - source hashes + minimal excerpts
  - avoid storing full raw PII unless explicitly required
- enforce run-level and tenant-level access controls

## 10) Risks and Mitigations
1. Volatile-source drift
- Mitigation: scheduled diff agent + forced live retrieval for selected doc families.

2. Hidden non-determinism in orchestration
- Mitigation: hard budgets, fixed node transitions, explicit failure states.

3. Case law mis-weighting
- Mitigation: explicit court-level and treatment weighting; label persuasive vs binding.

4. Over-cost from verifier loops
- Mitigation: cap retries, incremental verification, cache verified claim fragments.

5. PII/compliance exposure
- Mitigation: encryption at rest, retention policies, run-level access controls.

## 11) Product Policy: Default Analysis Date
- default mode: `as_of=today`
- if case facts include application/lock-in date or user requests retrospective mode, switch to `as_of=application_date`
- always show chosen mode in response header: `Analysis date basis: YYYY-MM-DD`

## 12) Team Split (Suggested)
Senior track:
- orchestration engine core, verifier hard-gate logic, temporal arbitration rules, final policy sign-off

Junior track:
- contracts pack, source-policy config, eval harness/CI wiring, failure-state test matrix, docs/runbooks, gold-set curation, registry scaffolding

Parallelization:
- junior owns non-complex deterministic work by default (target 75-85% of Phase 0 implementation)
- senior handles only high-complexity/high-risk control-plane tasks
- data factory and orchestration proceed concurrently once schema/config baselines are merged

## 13) Immediate Next 10 Days
1. Run parallel split kickoff from `docs/PHASE0_PARALLEL_EXECUTION_DELEGATION.md`.
2. Freeze schemas (`EvidenceBundle`, `ClaimLedger`, temporal artifact model).
3. Implement deterministic retrieval executor with current backend.
4. Add CI suite for hierarchy/routing/citation assertions.
5. Stand up volatility registry table and diff job skeleton.
6. Add debug payload persistence keyed by `run_id`.

## 14) Definition of Done (Program Level)
- System can answer current-state and as-of-date legal questions with auditable evidence.
- Every binding claim has binding authority support or explicit “no binding authority found.”
- Every run is reproducible from stored trace and artifact versions.
- RCIC reviewer can inspect claims, sources, and validation outcomes before relying on output.
