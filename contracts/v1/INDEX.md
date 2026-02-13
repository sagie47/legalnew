# Phase 0 Contracts Index

**Version: v1.0.0**  
**Status: Active**  
**Last Updated: 2026-02-13**

## Overview

This index documents the contract schemas for Phase 0 of the RCIC Legal Research Assistant. These contracts define the data structures used across retrieval, validation, and audit components.

## Schema List

| Schema File | Description |
|------------|-------------|
| `metadata.schema.json` | Document/chunk metadata with canonical identifiers |
| `evidenceBundle.schema.json` | Retrieved sources and citations |
| `claimLedger.schema.json` | Legal claims and their evidence provenance |
| `validationResult.schema.json` | Validation check results |
| `auditRunTrace.schema.json` | Complete audit trail of a research run |

## Example Files

| Example File | Schema |
|--------------|--------|
| `examples/metadata.example.json` | `metadata.schema.json` |
| `examples/evidenceBundle.example.json` | `evidenceBundle.schema.json` |
| `examples/claimLedger.example.json` | `claimLedger.schema.json` |
| `examples/validationResult.example.json` | `validationResult.schema.json` |
| `examples/validationResult.failure.example.json` | `validationResult.schema.json` (failure case) |
| `examples/auditRunTrace.example.json` | `auditRunTrace.schema.json` |

## Canonical Identifiers

All contracts use standardized identifier formats:

| ID Type | Format | Example |
|---------|--------|---------|
| `doc_id` | SHA256 of canonical_url (64 hex) | `a1b2c3d4e5f6...` |
| `content_hash` | SHA256 of content (64 hex) | `f6e5d4c3b2a1...` |
| `content_hash_prefix` | First 12 hex of content_hash | `f6e5d4c3b2a1` |
| `artifact_id` | `doc_id:content_hash_prefix` | `a1b2...:f6e5d4c3b2a1` |
| `chunk_id` | `artifact_id:chunk_index` | `a1b2...:f6e5d4c3b2a1:0` |
| `run_id` | ULID (26 chars) | `01HW3V8XK4Z5Y2J3M7P9Q0R2S6` |

## Required Fields

### Temporal Fields

| Field | Required | Description |
|-------|----------|-------------|
| `observed_at` | Always | Timestamp when content was first observed/crawled |
| `ingested_at` | Always | Timestamp when content was ingested into the system |
| `retrieved_at` | Always | Timestamp when chunk was retrieved for query |
| `published_at` | Optional | Timestamp of official publication |
| `effective_from` | Required-if* | Start date when content became effective |
| `effective_to` | Optional | End date when content ceased to be effective |

*Required-if: For `doc_family` in `{MI, PUBLIC_POLICY, OINP, BC_PNP, AAIP}`, include `effective_from`.

### Claim Validation Fields

| Field | Required | Description |
|-------|----------|-------------|
| `modality` | Always | Legal modality: `binding`, `permissive`, `informational` |
| `assertion_type` | Always | Type of legal assertion |
| `source_id` | Always | Source identifier |
| `source_hash` | Always | Hash of source content at retrieval time |
| `canonical_url` | Always | Original source URL |
| `quote_span` | Always | Character span [start:end] of quote in source |
| `quote_text` | Always | Exact quoted text from source |
| `in_force_check` | Always | Result of in-force verification |

## Document Family Values

```
IRPA, IRPR, MI, PUBLIC_POLICY, OINP, BC_PNP, AAIP,
OPERATIONAL_BULLETIN, OPERATIONAL_UPDATE, GUIDANCE,
CASE_LAW_FC, CASE_LAW_SCC, CASE_LAW_OTHER, OTHER
```

## Authority Level Values

```
PRIMARY_LEGISLATION, REGULATION, MINISTERIAL_INSTRUCTION,
POLICY, GUIDANCE, CASE_LAW, OTHER
```

## Assertion Type Values

```
ELIGIBILITY_REQUIREMENT, ADMISSIBILITY_CRITERION,
DOCUMENT_REQUIREMENT, PROCEDURE_REQUIREMENT,
DEADLINE_REQUIREMENT, FEE_REQUIREMENT,
DISCRETIONARY_FACTOR, POLICY_GUIDANCE,
CASE_LAW_PRINCIPLE, GENERAL_INFORMATION
```

## Failure State Codes

```
NONE, NO_BINDING_AUTHORITY, STALE_VOLATILE_SOURCE,
CITATION_MISMATCH, OUT_OF_SCOPE_SOURCE, BUDGET_EXCEEDED,
INSUFFICIENT_FACTS, INSUFFICIENT_EVIDENCE
```

## Validation Check Types

```
SCHEMA_CONFORMANCE, AUTHORITY_MODALITY_COMPATIBILITY,
ALLOWLIST_SCOPE, BLOCKLIST_SCOPE, BINDING_CLAIM_SOURCE,
TEMPORAL_VALIDITY, CITATION_TOKEN_VALID
```

## Usage

These contracts are used by:
- Phase 0 validation tooling (J4)
- Evaluation harness (J3)
- Failure-state test matrix (J5)
- Audit trace generation

All examples should validate against their respective schemas. Run validation with:

```bash
# Validate all examples against schemas
node contracts/v1/validate.js
```

Or with Python:

```bash
python contracts/v1/validate.py
```

## Versioning

- Schema version: `v1.0.0`
- Breaking changes require review before merge
- Examples are immutable - create new examples for schema updates

## Contact

For questions about these contracts, refer to `docs/phase0_contracts.md` or the Phase 0 delegation documentation.
