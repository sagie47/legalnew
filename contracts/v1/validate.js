#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

const SCHEMA_DIR = join(PROJECT_ROOT, 'contracts', 'v1');
const EXAMPLES_DIR = join(PROJECT_ROOT, 'contracts', 'v1', 'examples');

const SCHEMA_MAP = {
  'metadata.example.json': 'metadata.schema.json',
  'evidenceBundle.example.json': 'evidenceBundle.schema.json',
  'claimLedger.example.json': 'claimLedger.schema.json',
  'validationResult.example.json': 'validationResult.schema.json',
  'validationResult.failure.example.json': 'validationResult.schema.json',
  'auditRunTrace.example.json': 'auditRunTrace.schema.json'
};

function validateJson(jsonString) {
  try {
    JSON.parse(jsonString);
    return { valid: true, error: null };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

function loadSchema(schemaName) {
  const schemaPath = join(SCHEMA_DIR, schemaName);
  const content = readFileSync(schemaPath, 'utf-8');
  return JSON.parse(content);
}

function getExamples() {
  const files = readdirSync(EXAMPLES_DIR);
  return files.filter(f => f.endsWith('.json') && !f.endsWith('.schema.json'));
}

function validateAgainstSchema(data, schema) {
  const errors = [];
  
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in data)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }
  
  if (schema.properties) {
    for (const [key, value] of Object.entries(data)) {
      if (!(key in schema.properties)) {
        errors.push(`Unexpected field: ${key}`);
      }
      
      const propSchema = schema.properties[key];
      if (propSchema && propSchema.enum && !propSchema.enum.includes(value)) {
        errors.push(`Invalid value for ${key}: ${value} (allowed: ${propSchema.enum.join(', ')})`);
      }
      
      if (propSchema && propSchema.pattern) {
        const regex = new RegExp(propSchema.pattern);
        if (typeof value === 'string' && !regex.test(value)) {
          errors.push(`Invalid format for ${key}: ${value} (pattern: ${propSchema.pattern})`);
        }
      }
    }
  }
  
  return errors;
}

function main() {
  console.log('=== Phase 0 Schema Validation ===\n');
  
  const examples = getExamples();
  let totalPassed = 0;
  let totalFailed = 0;
  
  for (const exampleFile of examples) {
    const examplePath = join(EXAMPLES_DIR, exampleFile);
    const schemaFile = SCHEMA_MAP[exampleFile];
    
    if (!schemaFile) {
      console.log(`⚠️  SKIP: ${exampleFile} - no schema mapping`);
      continue;
    }
    
    console.log(`Validating: ${exampleFile}`);
    console.log(`  Schema:   ${schemaFile}`);
    
    try {
      const exampleContent = readFileSync(examplePath, 'utf-8');
      const parseResult = validateJson(exampleContent);
      
      if (!parseResult.valid) {
        console.log(`  ❌ FAILED: Invalid JSON - ${parseResult.error}`);
        totalFailed++;
        continue;
      }
      
      const exampleData = JSON.parse(exampleContent);
      const schema = loadSchema(schemaFile);
      const validationErrors = validateAgainstSchema(exampleData, schema);
      
      if (validationErrors.length > 0) {
        console.log(`  ❌ FAILED:`);
        for (const error of validationErrors) {
          console.log(`    - ${error}`);
        }
        totalFailed++;
      } else {
        console.log(`  ✅ PASSED`);
        totalPassed++;
      }
    } catch (error) {
      console.log(`  ❌ ERROR: ${error.message}`);
      totalFailed++;
    }
    
    console.log('');
  }
  
  console.log('=== Summary ===');
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalFailed}`);
  console.log('');
  
  if (totalFailed > 0) {
    console.log('❌ Schema validation FAILED');
    process.exit(1);
  } else {
    console.log('✅ All schema validations PASSED');
    process.exit(0);
  }
}

main();
