# Phase 0 Runbook

**Version: v1.0.0**  
**Last Updated: 2026-02-13**

## Quick Start

Run all Phase 0 validations:

```bash
npm run test:server && \
node contracts/v1/validate.js && \
node --test config/__tests__/sourcePolicy.test.js && \
node --test eval/__tests__/failureStateMatrix.test.js && \
node eval/run_eval.js
```

## Commands Reference

### Schema Validation

Validate all contract examples against schemas:

```bash
node contracts/v1/validate.js
```

Expected output:
```
=== Phase 0 Schema Validation ===

Validating: metadata.example.json
  Schema:   metadata.schema.json
  ✅ PASSED
...
=== Summary ===
Passed: 6
Failed: 0

✅ All schema validations PASSED
```

### Source Policy Tests

Run allowlist/blocklist tests:

```bash
node --test config/__tests__/sourcePolicy.test.js
```

Expected output:
```
✔ Source Policy: In-scope URL is accepted
✔ Source Policy: Blocked host is rejected
✔ Source Policy: Blocked path is rejected
✔ Source Policy: Doc family allow map
✔ Source Policy: Host path restrictions
ℹ tests 5
ℹ pass 5
```

### Failure State Matrix Tests

Run failure state definitions tests:

```bash
node --test eval/__tests__/failureStateMatrix.test.js
```

Expected output:
```
✔ Failure State Matrix: NO_BINDING_AUTHORITY is defined
...
ℹ tests 9
ℹ pass 9
```

### Evaluation Harness

Run gold set evaluation:

```bash
node eval/run_eval.js
```

Expected output:
```
=== Phase 0 Evaluation Harness ===

Loaded 15 gold set entries

Evaluating: What are the eligibility requirements...
  ✅ PASSED
...
=== Summary ===
Total:    15
Passed:   15
Failed:   0

✅ All evaluations PASSED
Report saved to: eval/reports/eval-report-{timestamp}.json
```

### Server Tests

Run backend unit tests:

```bash
npm run test:server
```

### Build

Build frontend:

```bash
npm run build
```

## Adding New Gold Set Entries

1. Edit `eval/gold/gold_set_template.jsonl`
2. Add entry with required fields:
   ```json
   {"query": "...", "as_of": "2026-02-13", "expected_doc_families": [...], "must_cite_authority_levels": [...], "must_not_cite_doc_families": [], "expected_failure_state": "NONE"}
   ```
3. Run `node eval/run_eval.js` to validate

## Adding New Source Policy Rules

1. Edit `config/source_policy.v1.json`
2. Update allowed_hosts, blocked_hosts, or doc_family_allow_map
3. Run `node --test config/__tests__/sourcePolicy.test.js`

## Troubleshooting

### Schema Validation Fails
- Check required fields match schema
- Verify enum values are in allowed list
- Ensure SHA256 hashes are 64 hex characters
- Ensure ULIDs are 26 alphanumeric characters

### Source Policy Tests Fail
- Verify URL is in correct format
- Check allowed_hosts includes the domain
- Ensure blocked_path_prefixes uses correct format

### Eval Harness Fails
- Check gold_set_template.jsonl has valid JSON per line
- Verify expected_failure_state matches defined codes
- Review eval/reports/*.json for detailed error info

## CI Pipeline

On push/PR to `contracts/**`, `config/**`, or `eval/**`:

1. **validate-contracts** - Schema + source policy tests
2. **run-eval-harness** - Gold set + eval runner
3. **test-server** - Backend unit tests
4. **build-frontend** - Build verification

Artifacts uploaded:
- `phase0-validation-report`
- `eval-reports`
- `frontend-build`

## File Locations

| Component | Location |
|-----------|----------|
| Schemas | `contracts/v1/*.schema.json` |
| Examples | `contracts/v1/examples/*.json` |
| Source Policy | `config/source_policy.v1.json` |
| Gold Set | `eval/gold/gold_set_template.jsonl` |
| Eval Runner | `eval/run_eval.js` |
| Failure Matrix | `eval/failure_state_matrix.json` |
| CI Workflow | `.github/workflows/phase0.yml` |
