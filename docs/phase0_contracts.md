# Phase 0 Contracts Guide

**Version: v1.0.0**  
**Last Updated: 2026-02-13**

## Overview

This document describes the contract schemas for Phase 0 of the RCIC Legal Research Assistant. These contracts define the data structures used across retrieval, validation, and audit components.

## Contract Schemas

All schemas are located in `contracts/v1/` and follow JSON Schema Draft 07.

### 1. Metadata Schema (`metadata.schema.json`)

Defines document and chunk metadata with canonical identifiers.

**Required Fields:**
- `doc_id` - SHA256 hash of canonical_url (64 hex characters)
- `artifact_id` - doc_id:content_hash_prefix
- `chunk_id` - artifact_id:chunk_index
- `observed_at` - Timestamp when content was first observed (ISO 8601)
- `ingested_at` - Timestamp when content was ingested (ISO 8601)
- `retrieved_at` - Timestamp when chunk was retrieved (ISO 8601)
- `canonical_url` - Original source URL
- `doc_family` - Document family classification
- `authority_level` - Level of legal authority

**Optional Fields:**
- `published_at`, `effective_from`, `effective_to`
- `instrument`, `jurisdiction`, `title`
- `heading_path`, `anchor`

### 2. Evidence Bundle Schema (`evidenceBundle.schema.json`)

Defines retrieved sources and citations for a query.

**Key Fields:**
- `bundle_id` - Unique identifier for this evidence bundle
- `run_id` - ULID (26 characters)
- `query` - The original user query
- `as_of` - Analysis date basis (YYYY-MM-DD)
- `sources[]` - Array of source objects

### 3. Claim Ledger Schema (`claimLedger.schema.json`)

Tracks legal claims and their evidence provenance.

**Key Fields:**
- `ledger_id` - Unique identifier for this ledger
- `run_id` - ULID
- `claims[]` - Array of claim objects

**Claim Structure:**
- `claim_id` - Unique claim identifier
- `text` - The claim text
- `assertions[]` - Supporting assertions

**Assertion Fields:**
- `modality` - binding, permissive, or informational
- `assertion_type` - Type of legal assertion
- `source_id`, `source_hash`, `canonical_url`
- `quote_span`, `quote_text`
- `in_force_check` - Temporal validity check

### 4. Validation Result Schema (`validationResult.schema.json`)

Defines validation check results.

**Key Fields:**
- `valid` - Overall pass/fail status
- `checks[]` - Array of validation checks
- `failure_state` - Failure code if validation failed
- `failure_message` - Human-readable message

**Check Types:**
- SCHEMA_CONFORMANCE
- AUTHORITY_MODALITY_COMPATIBILITY
- ALLOWLIST_SCOPE
- BLOCKLIST_SCOPE
- BINDING_CLAIM_SOURCE
- TEMPORAL_VALIDITY
- CITATION_TOKEN_VALID

### 5. Audit Run Trace Schema (`auditRunTrace.schema.json`)

Complete audit trail of a research run.

**Key Fields:**
- `trace_id` - Unique trace identifier
- `run_id` - ULID
- `query`, `as_of`, `user_id`
- `phases[]` - Execution phases in order
- `metadata` - Additional run metadata

**Phase Names:**
- RETRIEVAL
- ROUTING
- GROUNDING
- GENERATION
- VALIDATION
- RESPONSE_GUARD

## Enum Values

### Document Family
```
IRPA, IRPR, MI, PUBLIC_POLICY, OINP, BC_PNP, AAIP,
OPERATIONAL_BULLETIN, OPERATIONAL_UPDATE, GUIDANCE,
CASE_LAW_FC, CASE_LAW_SCC, CASE_LAW_OTHER, OTHER
```

### Authority Level
```
PRIMARY_LEGISLATION, REGULATION, MINISTERIAL_INSTRUCTION,
POLICY, GUIDANCE, CASE_LAW, OTHER
```

### Assertion Type
```
ELIGIBILITY_REQUIREMENT, ADMISSIBILITY_CRITERION,
DOCUMENT_REQUIREMENT, PROCEDURE_REQUIREMENT,
DEADLINE_REQUIREMENT, FEE_REQUIREMENT,
DISCRETIONARY_FACTOR, POLICY_GUIDANCE,
CASE_LAW_PRINCIPLE, GENERAL_INFORMATION
```

### Failure State Codes
```
NONE, NO_BINDING_AUTHORITY, STALE_VOLATILE_SOURCE,
CITATION_MISMATCH, OUT_OF_SCOPE_SOURCE, BUDGET_EXCEEDED,
INSUFFICIENT_FACTS, INSUFFICIENT_EVIDENCE
```

## Canonical Identifiers

| ID Type | Format | Example |
|---------|--------|---------|
| `doc_id` | SHA256 of canonical_url (64 hex) | `a1b2c3d4e5f6...` |
| `content_hash` | SHA256 of content (64 hex) | `f6e5d4c3b2a1...` |
| `content_hash_prefix` | First 12 hex | `f6e5d4c3b2a1` |
| `artifact_id` | doc_id:content_hash_prefix | `a1b2...:f6e5d4c3b2a1` |
| `chunk_id` | artifact_id:chunk_index | `a1b2...:f6e5d4c3b2a1:0` |
| `run_id` | ULID (26 chars) | `01HW3V8XK4Z5Y2J3M7P9Q0R2S6` |

## Validation

Run schema validation:

```bash
node contracts/v1/validate.js
```

## Examples

See `contracts/v1/examples/` for canonical examples:
- `metadata.example.json`
- `evidenceBundle.example.json`
- `claimLedger.example.json`
- `validationResult.example.json`
- `validationResult.failure.example.json`
- `auditRunTrace.example.json`
