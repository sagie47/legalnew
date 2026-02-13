# Phase 0 Test Plan

**Version: v1.0.0**  
**Last Updated: 2026-02-13**

## Overview

This document describes the testing strategy for Phase 0 contracts, source policy, and evaluation harness.

## Test Categories

### 1. Schema Validation Tests

**Purpose:** Ensure all contract examples conform to their schemas.

**Runner:** `contracts/v1/validate.js`

**Validates:**
- Required fields present
- Enum values valid
- Pattern formats correct (doc_id, run_id, etc.)

**Exit Criteria:** All examples pass validation

### 2. Source Policy Tests

**Purpose:** Verify allowlist/blocklist enforcement.

**Runner:** `config/__tests__/sourcePolicy.test.js`

**Test Cases:**
| Test | Description |
|------|-------------|
| In-scope URL accepted | IRPA, IRPR, case law URLs allowed |
| Blocked host rejected | example.com, test-site.com blocked |
| Blocked path rejected | /wp-content/, /ads/ blocked |
| Doc family allow map | IRPA/IRPR allowed, OTHER blocked |
| Host path restrictions | laws-lois.justice.gc.ca /eng/acts/ allowed |

**Exit Criteria:** All 5 tests pass

### 3. Failure State Matrix Tests

**Purpose:** Verify all failure states are properly defined.

**Runner:** `eval/__tests__/failureStateMatrix.test.js`

**Test Cases:**
| Failure State | Tests Defined |
|--------------|---------------|
| NONE | Retry policy is N/A |
| NO_BINDING_AUTHORITY | Defined with ERROR severity |
| STALE_VOLATILE_SOURCE | Defined with required audit fields |
| CITATION_MISMATCH | Defined |
| OUT_OF_SCOPE_SOURCE | Defined |
| BUDGET_EXCEEDED | Defined with WARNING severity |
| INSUFFICIENT_FACTS | Defined with INFO severity |
| INSUFFICIENT_EVIDENCE | Defined |

**Exit Criteria:** All 8 states defined + 9 tests pass

### 4. Evaluation Harness Tests

**Purpose:** Verify gold set entries and eval runner.

**Runner:** `eval/run_eval.js`

**Validates:**
- Gold set entry format (query, as_of, expected_failure_state)
- Stub retrieval returns expected sources
- Validator checks produce correct failure states

**Gold Set Coverage:**
- TRV/Study/Work/EE queries
- Hierarchy edge cases (policy vs law)
- Temporal queries (as_of required)
- Expected failure-state cases (INSUFFICIENT_FACTS)

**Exit Criteria:** All gold set entries produce expected results

## CI Integration

All tests run in `.github/workflows/phase0.yml`:

```yaml
jobs:
  - validate-contracts:  # Schema + Source Policy
  - run-eval-harness:  # Gold set + Eval runner
  - test-server:        # Server unit tests
  - build-frontend:    # Build verification
```

## Running Tests Locally

### All Phase 0 Tests
```bash
npm run test:server
node contracts/v1/validate.js
node --test config/__tests__/sourcePolicy.test.js
node --test eval/__tests__/failureStateMatrix.test.js
node eval/run_eval.js
```

### Individual Test Suites
```bash
# Schema validation
node contracts/v1/validate.js

# Source policy
node --test config/__tests__/sourcePolicy.test.js

# Failure state matrix
node --test eval/__tests__/failureStateMatrix.test.js

# Eval harness
node eval/run_eval.js
```

## Interpreting Failures

### Schema Validation Failures
- Check required fields match schema
- Verify enum values are valid
- Ensure patterns match (SHA256, ULID)

### Source Policy Failures
- Verify URL is in allowed_hosts list
- Check blocked_path_prefixes doesn't match
- Validate host path restrictions

### Eval Harness Failures
- Check gold set entry format
- Verify expected_failure_state matches stub behavior
- Review eval/reports/*.json for details

## Artifacts

After CI run, artifacts available:
- `phase0-validation-report` - Schema validation results
- `eval-reports` - Eval harness JSON reports
- `frontend-build` - Built frontend bundle
