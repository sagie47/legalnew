# Phase 1 Runtime Policy

Last updated: 2026-02-13  
Owner: Senior Engineering  
Status: Active

## Purpose
Define the authoritative Phase 1 runtime policy for:
- retrieval fallback behavior
- failure-state precedence
- user-facing fallback notices
- analysis-date response header behavior

## Retrieval Fallback Policy
- Tiered retrieval is enabled by default.
- Silent fallback to unfiltered retrieval is disabled by default.

Runtime default:
- `RAG_NO_SILENT_FALLBACK_ENABLED=true` (unless explicitly overridden in env)

Expected behavior:
1. Run filtered Tier A/Tier B retrieval.
2. If Tier A returns no binding authority and the query requires binding:
   - emit `NO_BINDING_AUTHORITY`
   - prepend binding fallback notice.
3. Do not silently broaden scope unless explicitly enabled.

## Failure-State Precedence (Deterministic)
The resolver applies this order:
1. `OUT_OF_SCOPE_SOURCE`
2. `BUDGET_EXCEEDED`
3. `CITATION_MISMATCH`
4. `STALE_VOLATILE_SOURCE`
5. `NO_BINDING_AUTHORITY`
6. `INSUFFICIENT_EVIDENCE`
7. `INSUFFICIENT_FACTS`
8. `NONE`

Source of truth:
- `server/rag/failureStates.js`

## User-Facing Notice Policy
When `failureState` is one of:
- `NO_BINDING_AUTHORITY`
- `STALE_VOLATILE_SOURCE`
- `CITATION_MISMATCH`
- `BUDGET_EXCEEDED`
- `INSUFFICIENT_FACTS`
- `INSUFFICIENT_EVIDENCE`

The runtime prepends the matrix-backed notice to response body (deduplicated).

Exceptions:
- `OUT_OF_SCOPE_SOURCE` uses explicit blocking response text path.
- `NONE` adds no failure notice.

## Analysis Date Header Policy
All `/api/chat` responses prepend:
- `Analysis date basis: YYYY-MM-DD (basis)`

Applies to:
- success
- blocked/out-of-scope
- error

Basis values:
- `today`
- `application_date`
- `explicit_as_of`

## Debug Contract (Phase 1)
When `DEBUG_MODE=true`, response debug payload must include:
- `analysisDate` (`basis`, `asOf`)
- `failureState`
- `failureStateInfo`
- `budget`
- retrieval diagnostics (filters, tiers, source mix/counts)

## Validation and Tests
Runtime policy is validated by:
- `server/rag/__tests__/failureStates.test.js`
- `server/rag/__tests__/responsePolicy.test.js`
- `server/rag/__tests__/auditTrace.test.js`
- `eval/__tests__/failureStateMatrix.test.js`
