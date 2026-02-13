# Legal RAG Parallel Delegation (Junior)

Last updated: 2026-02-13
Owner: Junior Engineer
Reviewer: Senior Engineer

## Goal
Prepare metadata and validation foundations for authority-aware legal retrieval without changing model behavior yet.

## Working Rules
- Work in small PRs (one track per PR).
- Do not change vector IDs.
- Do not re-embed for this phase.
- Preserve backward compatibility for existing metadata fields.

## Parallel Tracks

### Track A: Metadata Enrichment in Ingestion Pipelines
Scope:
- `scripts/ingest_md/ingest_md.py`
- `scripts/ingest_pdf/chunk.py`
- `server/ingest/pdi/index.js`

Required metadata fields to add on each vector:
- `authority_level`
- `doc_family`
- `instrument`
- `jurisdiction`
- `effective_date`

Also add when known:
- `expiry_date`
- `section_id`
- `program_stream`
- `noc_code`
- `teer`
- `table_type`

Implementation notes:
- Keep old fields (`source_type`, `manual`, `chapter`, etc.) for compatibility.
- Use deterministic mapping rules and avoid free-text values.
- If unknown, omit field (do not invent).

Acceptance criteria:
- New ingest run writes the canonical metadata fields.
- Existing query behavior is unchanged.
- No ID churn.

---

### Track B: Metadata Validation Utility
Scope:
- `scripts/ingest_md/validate_namespace.py`

Add checks for:
- presence rates of new fields
- invalid enum values
- date format validation (`YYYY-MM-DD`)
- counts by `authority_level`, `doc_family`, `instrument`, `jurisdiction`

Output:
- clear pass/fail summary
- sample invalid records (IDs only)

Acceptance criteria:
- Script fails on invalid enum/date values.
- Script prints distribution counts for all canonical fields.

---

### Track C: Dataset Mapping Table + Rules
Scope:
- New doc: `docs/LEGAL_METADATA_MAPPING.md` (create if missing)

Document:
- source-to-metadata mapping table (IRPA/IRPR/MI/PDI/ENF/VOI/OINP/BC_PNP/AAIP/NOC/LICO_MNI/CASE_LAW)
- instrument tagging rules
- jurisdiction rules
- effective/expiry date extraction rules
- section ID normalization patterns

Acceptance criteria:
- Reviewer can map any ingested source to canonical metadata without ambiguity.

## Suggested Task Split (Parallel)
1. Engineer A: Track A (`ingest_md`)
2. Engineer B: Track A (`ingest_pdf` + `pdi`)
3. Engineer C: Track B + Track C

## Commands
Local validation:
```bash
npm run test:server
python scripts/ingest_md/validate_namespace.py --namespace <NAMESPACE>
```

Sample ingest smoke checks:
```bash
python scripts/ingest_md/ingest_md.py --directory scripts/scraper/ircc_data_clean --max-files 1 --namespace <NAMESPACE> --no-delete-existing-source --skip-existing-ids
python scripts/ingest_pdf/ingest_pdf.py --directory scripts/pdfs --max-files 1 --dry-run --namespace <NAMESPACE>
```

## Handoff Checklist
- PR links for each track
- before/after namespace validation output
- list of added metadata keys with example values
- any unknown/unmapped sources logged in a short appendix
