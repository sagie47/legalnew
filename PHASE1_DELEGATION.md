# Phase 1 Delegation Plan (Parallel Execution)

## Objective
Ship a **trustworthy citations baseline** for chat answers:
- deterministic retrieval orchestration (Pinecone + A2AJ)
- no phantom citations
- graceful degradation when A2AJ fails
- regression harness for grounding + citation validity

## Phase 1 Scope (Bounded)
In scope:
1. A2AJ top-result detail-fetch policy
2. Citation provenance hardening in API payload
3. Citation-token validation hardening
4. Regression tests for citation correctness + failure modes

Out of scope (Phase 2+):
- document uploads / OCR / vision extraction
- autonomous model tool-calling loops
- schema redesign for tenancy

---

## Parallel Workstreams

## Workstream A (Engineer): Retrieval Reliability
**Primary goal:** Improve legal answer depth by enriching top case results with fetch details.

**Owned files (do not edit outside this set unless needed for compile):**
- `server/clients/a2aj.js`
- `server/rag/router.js` (only if routing thresholds need tuning)
- `server/index.js` (only the A2AJ orchestration block)

**Tasks:**
1. Implement/verify "search -> top-N detail fetch" policy in `a2ajEnrichCaseSources()`.
2. Enforce bounded fetch count via env (`A2AJ_FETCH_DETAILS_TOP_K`, default 2-3).
3. Guarantee non-fatal behavior on fetch failure (retain search snippet, no 500).
4. Improve excerpt selection so conclusions/outcomes are favored when present.
5. Add debug counters in response payload (optional, behind `DEBUG_MODE`).

**Deliverables:**
- PR with retrieval changes
- short note with env defaults and expected latency impact

**Definition of done:**
- If A2AJ detail fetch fails, chat still responds with Pinecone + available A2AJ snippets.
- Top-N detail fetch demonstrably improves answer quality on golden prompts.

---

## Workstream B (Codex): Citation Contract + Test Harness
**Primary goal:** Ensure citations are always valid, complete, and UI-usable.

**Owned files:**
- `server/rag/grounding.js`
- `server/index.js` (citation mapping + payload only)
- `server/ingest/pdi/__tests__/index.test.js` (or add new tests)
- `server/ingest/pdi/__tests__/upsert.test.js` (only if needed)
- `lib/types.ts` (citation type contract only)
- `CITATION_SYSTEM.md` (doc updates)

**Tasks:**
1. Harden `validateCitationTokens()` and `extractCitations()` expectations.
2. Ensure citation objects always include stable keys for UI resolution (`id`, `referenceId`, `caseId`, `sourceType`, `title`, `snippet`).
3. Add regression tests:
   - invalid citation tokens removed
   - only existing citation IDs survive
   - response contains mapped citation objects for all extracted IDs
   - no crash when citation map is empty
4. Add/refresh developer docs describing citation contract and failure behavior.

**Deliverables:**
- PR with test-backed citation hardening
- updated citation contract section in docs

**Definition of done:**
- No phantom citations in final text.
- Inline citation click targets resolve consistently.
- Tests pass with `npm run test:server`.

---

## Shared Contract (Avoid Merge Conflicts)

## Backend response contract (`POST /api/chat`)
Must remain:
```json
{
  "text": "...",
  "citations": [
    {
      "id": "P1",
      "referenceId": "P1",
      "caseId": "P1",
      "sourceType": "pinecone|a2aj_case",
      "title": "...",
      "snippet": "...",
      "locator": "...",
      "url": "..."
    }
  ],
  "sessionId": "uuid"
}
```

## Citation token policy
- Allowed inline tokens: `[P#]`, `[C#]`
- Any token not present in current `citationMap` must be removed before returning `text`.

## Failure policy
- A2AJ failures are warnings, never fatal to chat completion.
- If no sources are available, response may be low-confidence but must not crash.

---

## Merge-Safe Boundaries
To let both contributors work simultaneously:
1. **Engineer** avoids `buildCitationFromSource()` and citation payload shaping.
2. **Codex** avoids A2AJ HTTP endpoint logic and query strategy changes.
3. Shared file `server/index.js` split by ownership:
   - Engineer owns A2AJ retrieval block
   - Codex owns citation mapping block
4. If both need `server/index.js`, use one of:
   - separate commits touching non-overlapping ranges
   - small refactor first to isolate helpers, then parallel edits

---

## Branch & Integration Plan
1. Create branches:
   - `phase1/retrieval-reliability` (Engineer)
   - `phase1/citation-hardening` (Codex)
2. Daily sync on:
   - env var changes
   - response contract changes
   - `server/index.js` touched ranges
3. Integration order:
   1. merge retrieval branch
   2. rebase citation branch
   3. run full tests + manual golden prompts

---

## Golden Prompt Pack (Phase 1 Acceptance)
Run these after both branches merge:
1. "Explain outcome of Dickson v. Vuntut Gwitchin First Nation with citations."
2. "Give FC authorities on study permit refusal reasonableness."
3. "Provide cases on procedural fairness in visitor visa refusals."
4. "A2AJ outage simulation" (force search failure): app still responds without 500.

Pass criteria:
- no invented citation IDs
- all returned citation IDs exist in `citations[]`
- no uncaught errors in server logs

---

## Risks and Mitigations
1. **Risk:** Latency increase from detail fetch.
   - Mitigation: cap fetch count, timeout, and fallback behavior.
2. **Risk:** Citation shape drift breaks UI click behavior.
   - Mitigation: preserve legacy keys (`caseId`, `citation`) while keeping new keys.
3. **Risk:** Merge conflict in `server/index.js`.
   - Mitigation: strict ownership and small helper extraction.

---

## Implementation Checklist
- [ ] Engineer branch created
- [ ] Codex branch created
- [ ] Shared contract acknowledged
- [ ] Retrieval PR merged
- [ ] Citation/test PR merged
- [ ] Golden prompts validated
- [ ] Phase 1 release candidate tagged
