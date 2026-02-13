import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSourcePolicy, isUrlAllowed, isDocFamilyAllowed } from '../sourcePolicy.js';

const policy = loadSourcePolicy();

test('Source Policy: In-scope URL is accepted', () => {
  const testCases = [
    {
      url: 'https://laws-lois.justice.gc.ca/eng/acts/I-2.5/page-1.html',
      description: 'IRPA main page'
    },
    {
      url: 'https://laws-lois.justice.gc.ca/eng/regulations/SOR-2002-227/page-1.html',
      description: 'IRPR main page'
    },
    {
      url: 'https://decisions.fct-cf.gc.ca/fc-cf/decisions/en/item/123456/index.do',
      description: 'Federal Court decision'
    },
    {
      url: 'https://www.canada.ca/en/immigration-refugees-citizenship/corporate/mandate/policies-operational-instructions-agreements/ministerial-instructions/express-entry/mi-2024-12-17.html',
      description: 'Ministerial Instruction'
    },
    {
      url: 'https://www.ontario.ca/immigration/oinp-express-entry',
      description: 'OINP page'
    }
  ];

  for (const tc of testCases) {
    const result = isUrlAllowed(tc.url, policy);
    assert.equal(result.allowed, true, `Expected ${tc.description} to be allowed`);
  }
});

test('Source Policy: Blocked host is rejected', () => {
  const testCases = [
    {
      url: 'https://example.com/legal-advice',
      description: 'example.com domain'
    },
    {
      url: 'https://test-site.com/immigration',
      description: 'test-site.com domain'
    },
    {
      url: 'https://fake-legal-advice.org/canada',
      description: 'fake-legal-advice.org domain'
    }
  ];

  for (const tc of testCases) {
    const result = isUrlAllowed(tc.url, policy);
    assert.equal(result.allowed, false, `Expected ${tc.description} to be blocked`);
    assert.equal(result.reason, 'HOST_BLOCKED', `Expected reason to be HOST_BLOCKED`);
  }
});

test('Source Policy: Blocked path is rejected', () => {
  const testCases = [
    {
      url: 'https://laws-lois.justice.gc.ca/wp-content/uploads/2024/01/document.pdf',
      description: 'wp-content path'
    },
    {
      url: 'https://canada.ca/ads/sponsored.html',
      description: 'ads path'
    },
    {
      url: 'https://www.canada.ca/outbound/redirect?url=http://malicious.com',
      description: 'outbound path'
    }
  ];

  for (const tc of testCases) {
    const result = isUrlAllowed(tc.url, policy);
    assert.equal(result.allowed, false, `Expected ${tc.description} to be blocked`);
    assert.equal(result.reason, 'PATH_BLOCKED', `Expected reason to be PATH_BLOCKED`);
  }
});

test('Source Policy: Doc family allow map', () => {
  const allowedDocFamilies = ['IRPA', 'IRPR', 'MI', 'PUBLIC_POLICY', 'OINP', 'BC_PNP', 'AAIP', 'CASE_LAW_FC', 'CASE_LAW_SCC'];
  
  for (const docFamily of allowedDocFamilies) {
    const result = isDocFamilyAllowed(docFamily, policy);
    assert.equal(result.allowed, true, `Expected ${docFamily} to be allowed`);
  }

  const blockedResult = isDocFamilyAllowed('OTHER', policy);
  assert.equal(blockedResult.allowed, false, 'Expected OTHER to be blocked');
});

test('Source Policy: Host path restrictions', () => {
  const pathRestrictedCases = [
    {
      url: 'https://laws-lois.justice.gc.ca/blog/post.html',
      shouldBeAllowed: false,
      description: 'Non-allowed path on laws-lois.justice.gc.ca'
    },
    {
      url: 'https://laws-lois.justice.gc.ca/eng/acts/I-2.5/page-1.html',
      shouldBeAllowed: true,
      description: 'Allowed path on laws-lois.justice.gc.ca'
    }
  ];

  for (const tc of pathRestrictedCases) {
    const result = isUrlAllowed(tc.url, policy);
    assert.equal(result.allowed, tc.shouldBeAllowed, tc.description);
  }
});
