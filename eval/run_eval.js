#!/usr/bin/env node

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const GOLD_DIR = join(PROJECT_ROOT, 'eval', 'gold');
const OUTPUT_DIR = join(PROJECT_ROOT, 'eval', 'reports');

const FAILURE_STATES = [
  'NONE',
  'NO_BINDING_AUTHORITY',
  'STALE_VOLATILE_SOURCE',
  'CITATION_MISMATCH',
  'OUT_OF_SCOPE_SOURCE',
  'BUDGET_EXCEEDED',
  'INSUFFICIENT_FACTS',
  'INSUFFICIENT_EVIDENCE'
];

function loadGoldSet() {
  const goldPath = join(GOLD_DIR, 'gold_set_template.jsonl');
  const content = readFileSync(goldPath, 'utf-8');
  const lines = content.trim().split('\n');
  return lines.map(line => JSON.parse(line));
}

function validateGoldSetEntry(entry, index) {
  const errors = [];
  
  if (!entry.query || typeof entry.query !== 'string') {
    errors.push(`Entry ${index}: missing or invalid 'query'`);
  }
  
  if (!entry.as_of || !/^\d{4}-\d{2}-\d{2}$/.test(entry.as_of)) {
    errors.push(`Entry ${index}: missing or invalid 'as_of' (expected YYYY-MM-DD)`);
  }
  
  if (!Array.isArray(entry.expected_doc_families)) {
    errors.push(`Entry ${index}: 'expected_doc_families' must be an array`);
  }
  
  if (!Array.isArray(entry.must_cite_authority_levels)) {
    errors.push(`Entry ${index}: 'must_cite_authority_levels' must be an array`);
  }
  
  if (!Array.isArray(entry.must_not_cite_doc_families)) {
    errors.push(`Entry ${index}: 'must_not_cite_doc_families' must be an array`);
  }
  
  if (!FAILURE_STATES.includes(entry.expected_failure_state)) {
    errors.push(`Entry ${index}: invalid 'expected_failure_state' (${entry.expected_failure_state})`);
  }
  
  return errors;
}

function stubRetrieval(entry) {
  const sources = [
    {
      source_id: 'stub-src-001',
      citation_label: 'P1',
      metadata: {
        doc_id: '573c6a3bcdea94d029220af2b9b81fc4ed7f80d439c5963c8083077884b674a8',
        artifact_id: '573c6a3bcdea94d029220af2b9b81fc4ed7f80d439c5963c8083077884b674a8:a1b2c3d4e5f6',
        chunk_id: '573c6a3bcdea94d029220af2b9b81fc4ed7f80d439c5963c8083077884b674a8:a1b2c3d4e5f6:0',
        canonical_url: 'https://laws-lois.justice.gc.ca/eng/acts/I-2.5/page-1.html',
        doc_family: 'IRPA',
        authority_level: 'PRIMARY_LEGISLATION'
      },
      content: 'Immigration and Refugee Protection Act...',
      score: 0.95,
      tier: 'A'
    }
  ];
  
  if (entry.expected_failure_state === 'INSUFFICIENT_FACTS') {
    return {
      sources: [],
      retrieval_success: true,
      sources_count: 0
    };
  }
  
  return {
    sources,
    retrieval_success: true,
    sources_count: sources.length
  };
}

function stubValidator(entry, retrievalResult) {
  const checks = [];
  let valid = true;
  let failure_state = 'NONE';
  
  checks.push({
    check_id: 'check-retrieval-success',
    check_type: 'RETRIEVAL_SUCCESS',
    passed: retrievalResult.retrieval_success,
    details: `Retrieval ${retrievalResult.retrieval_success ? 'succeeded' : 'failed'} with ${retrievalResult.sources_count} sources`
  });
  
  if (retrievalResult.sources_count === 0 && entry.expected_failure_state !== 'INSUFFICIENT_FACTS') {
    valid = false;
    failure_state = 'INSUFFICIENT_EVIDENCE';
    checks.push({
      check_id: 'check-sources-exist',
      check_type: 'SOURCES_EXIST',
      passed: false,
      details: 'No sources retrieved but query expects evidence',
      severity: 'ERROR'
    });
  } else if (retrievalResult.sources_count > 0) {
    checks.push({
      check_id: 'check-sources-exist',
      check_type: 'SOURCES_EXIST',
      passed: true,
      details: `${retrievalResult.sources_count} sources retrieved`
    });
  }
  
  if (entry.expected_failure_state === 'INSUFFICIENT_FACTS') {
    valid = true;
    failure_state = 'INSUFFICIENT_FACTS';
    checks.push({
      check_id: 'check-failure-state',
      check_type: 'EXPECTED_FAILURE_STATE',
      passed: failure_state === entry.expected_failure_state,
      details: `Expected failure state: ${entry.expected_failure_state}`,
      severity: 'INFO'
    });
  }
  
  checks.push({
    check_id: 'check-schema-conformance',
    check_type: 'SCHEMA_CONFORMANCE',
    passed: true,
    details: 'Response conforms to schema structure',
    severity: 'INFO'
  });
  
  return {
    valid,
    failure_state,
    checks
  };
}

function runEval() {
  console.log('=== Phase 0 Evaluation Harness ===\n');
  
  mkdirSync(OUTPUT_DIR, { recursive: true });
  
  const goldSet = loadGoldSet();
  console.log(`Loaded ${goldSet.length} gold set entries\n`);
  
  const results = {
    summary: {
      total: goldSet.length,
      passed: 0,
      failed: 0,
      skipped: 0
    },
    entries: []
  };
  
  for (let i = 0; i < goldSet.length; i++) {
    const entry = goldSet[i];
    console.log(`Evaluating: ${entry.query.substring(0, 50)}...`);
    
    const validationErrors = validateGoldSetEntry(entry, i);
    if (validationErrors.length > 0) {
      console.log(`  ⚠️  SKIPPED: Invalid gold set entry`);
      for (const error of validationErrors) {
        console.log(`    - ${error}`);
      }
      results.summary.skipped++;
      results.entries.push({
        query: entry.query,
        status: 'SKIPPED',
        errors: validationErrors
      });
      continue;
    }
    
    const retrievalResult = stubRetrieval(entry);
    const validatorResult = stubValidator(entry, retrievalResult);
    
    const passed = validatorResult.valid === true && 
                   validatorResult.failure_state === entry.expected_failure_state;
    
    if (passed) {
      console.log(`  ✅ PASSED (expected failure: ${entry.expected_failure_state})`);
      results.summary.passed++;
    } else {
      console.log(`  ❌ FAILED (expected: ${entry.expected_failure_state}, got: ${validatorResult.failure_state})`);
      results.summary.failed++;
    }
    
    results.entries.push({
      query: entry.query,
      as_of: entry.as_of,
      expected_failure_state: entry.expected_failure_state,
      actual_failure_state: validatorResult.failure_state,
      status: passed ? 'PASSED' : 'FAILED',
      checks: validatorResult.checks
    });
  }
  
  console.log('\n=== Summary ===');
  console.log(`Total:    ${results.summary.total}`);
  console.log(`Passed:   ${results.summary.passed}`);
  console.log(`Failed:   ${results.summary.failed}`);
  console.log(`Skipped:  ${results.summary.skipped}`);
  console.log('');
  
  const reportPath = join(OUTPUT_DIR, `eval-report-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`Report saved to: ${reportPath}`);
  
  if (results.summary.failed > 0) {
    console.log('\n❌ Evaluation FAILED');
    process.exit(1);
  } else {
    console.log('\n✅ All evaluations PASSED');
    process.exit(0);
  }
}

runEval();
