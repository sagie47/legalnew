# Phase 1 Delegation Plan (Parallel Execution)

Last updated: 2026-02-13  
Scope window: Phase 1 only (deterministic retrieval core + runtime enforcement)

## Objective
Ship a deterministic, auditable Phase 1 runtime that:
- enforces tiered legal retrieval (binding vs guidance)
- emits stable failure-state behavior
- produces contract-valid audit traces
- runs evaluation gates in CI for routing/retrieval/prompt changes

## Phase 1 Scope (Bounded)
In scope:
1. Deterministic runtime executor in `/api/chat`
2. Tiered retrieval enforcement and no-silent-fallback behavior
3. Claim/failure guard integration with structured debug payload
4. Audit trace contract wiring + validation in runtime
5. CI/eval gates for Phase 1 change surfaces

Out of scope (Phase 2+):
- Deep LangGraph rollout
- Full live volatility crawler platform migration
- Full DB-backed audit package retention system
- UI redesign unrelated to debug/audit visibility

## Delegation Policy (Junior-First)
- Default assignment rule: deterministic and bounded work goes to junior.
- Senior only handles architecture-critical semantics and cross-cutting runtime arbitration.
- Target allocation for Phase 1:
  - Junior: 70-80%
  - Senior: 20-30%

Complexity rubric:
- `L0/L1`: junior default
- `L2`: junior with senior review
- `L3/L4`: senior owner

## Hard Boundaries
- Junior does not change legal-policy semantics without explicit senior approval.
- Junior can modify runtime code in Phase 1, but only within assigned tracks and contracts.
- Senior owns final precedence rules for:
  - failure-state resolution
  - temporal arbitration (`today` vs `application_date` vs `explicit_as_of`)
  - binding-claim enforcement behavior

## Parallel Ownership Map
Junior owns:
- CI and eval coverage expansion for Phase 1
- runtime observability additions that do not alter policy semantics
- deterministic tests (routing/failure-state/audit-contract checks)
- docs/runbooks and release validation checklists
- low-risk runtime refactors that improve testability

Senior owns:
- failure-state/fallback semantics
- retrieval policy arbitration and precedence decisions
- audit trace contract runtime compatibility sign-off
- Phase 1 go/no-go decision

Shared (review-only while active):
- `PHASE1_DELEGATION.md`
- `docs/RCIC_AGENTIC_RESEARCH_ROADMAP.md`
- `docs/PHASE0_SIGNOFF.md`

## Junior Tracks (Precise Directions)

### Track J1: Phase 1 CI Gates
Goal:
- enforce Phase 1 behavior in CI on relevant change surfaces.

Deliverables:
- update `.github/workflows/phase0.yml` or add `.github/workflows/phase1.yml` with:
  - schema validation
  - source-policy tests
  - eval harness
  - `server/rag/__tests__/*` unit tests
- include triggers for:
  - `server/rag/**`
  - `server/index.js`
  - `eval/**`
  - `contracts/**`
  - `config/**`

Acceptance:
- CI fails on Phase 1 regressions and uploads eval artifacts.

---

### Track J2: Retrieval Debug Payload Standardization
Goal:
- make retrieval behavior diagnosable without reading logs.

Deliverables:
- ensure `/api/chat` debug payload always includes:
  - applied tier filters
  - top_k per tier
  - authority/doc-family counts
  - top source IDs + scores
  - analysis date basis (`basis`, `asOf`)
- add deterministic unit tests for payload presence/shape.

Constraints:
- do not alter retrieval semantics.

Acceptance:
- debug payload shape is stable across success/failure responses.

---

### Track J3: Audit Trace Contract Test Coverage
Goal:
- validate runtime trace contract compatibility continuously.

Deliverables:
- add/extend tests under `server/rag/__tests__/auditTrace.test.js` for:
  - blocked/out-of-scope path
  - normal success path
  - exception path
  - contract validation failure detection
- ensure tests assert:
  - `run_id` ULID pattern
  - required phase fields
  - `as_of` format

Acceptance:
- tests pass and fail deterministically on contract drift.

---

### Track J4: Failure-State Matrix Sync Tests
Goal:
- prevent drift between runtime resolver and `eval/failure_state_matrix.json`.

Deliverables:
- add tests that assert runtime resolver exports all matrix codes.
- assert mapped metadata (`severity`, retryability) for each code used in runtime.
- add mismatch test that fails if matrix updates without runtime sync.

Constraints:
- tests + low-risk plumbing only; no semantic changes.

Acceptance:
- any matrix/runtime enum drift fails CI.

---

### Track J5: Gold Set Phase 1 Expansion
Goal:
- raise regression confidence for routing/hierarchy/temporal cases.

Deliverables:
- expand gold set from 39 to 60+ entries with coverage on:
  - TRV/study/work/EE/PNP
  - compare-intent cases (MI vs PDI)
  - no-binding-authority scenarios
  - insufficient-facts scenarios
  - temporal `as_of` switching scenarios

Acceptance:
- eval harness runs clean and report artifacts are generated.

---

### Track J6: Phase 1 Runbook + Incident Playbook
Goal:
- make operations and troubleshooting explicit.

Deliverables:
- `docs/phase1_runbook.md`:
  - local verification commands
  - debug payload interpretation
  - failure-state troubleshooting flow
- `docs/phase1_incident_playbook.md`:
  - handling `NO_BINDING_AUTHORITY`
  - handling `STALE_VOLATILE_SOURCE`
  - handling `CITATION_MISMATCH`

Acceptance:
- reviewer can run and troubleshoot Phase 1 from docs only.

## Senior Tracks (Parallel)

### Track S1: Retrieval Semantics Arbitration
- finalize binding/guidance fallback and precedence semantics.
- lock no-silent-fallback behavior and user-facing fallback text.

### Track S2: Failure-State Runtime Arbitration
- own final precedence and trigger rules for all failure states.
- approve any runtime changes that alter user-visible behavior.

### Track S3: Temporal Arbitration
- finalize date-basis switching policy:
  - default `today`
  - switch to `application_date` when present
  - allow explicit `as_of` override
- enforce response header behavior for date basis.

### Track S4: Phase 1 Sign-Off
- run end-to-end validation against acceptance criteria.
- publish Phase 1 sign-off memo with go/no-go and residual risks.

## Merge Order (Low Conflict)
1. J1 (CI gates)
2. J3 (audit trace tests)
3. J4 (matrix sync tests)
4. J2 (debug payload standardization)
5. J5 (gold set expansion)
6. J6 (runbook + incident docs)
7. Senior tracks (S1-S4)

## Daily Status Template (Required)
- `Track:`
- `PR:`
- `Tests:`
- `Blocked by:`
- `Next:`

## Phase 1 Acceptance Criteria
- deterministic failure-state behavior across success/blocked/error paths
- tiered retrieval debug payload consistently emitted in debug mode
- audit trace contract validates in runtime tests
- eval harness CI gate active for server/rag/retrieval change surfaces
- expanded gold set passes in CI

## Commands (Minimum)
```bash
npm run test:server
node contracts/v1/validate.js
node --test config/__tests__/sourcePolicy.test.js
node --test eval/__tests__/failureStateMatrix.test.js
node --test server/rag/__tests__/auditTrace.test.js
node --test server/rag/__tests__/failureStates.test.js
node eval/run_eval.js
```
