import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveIngestUrls } from '../index.js';

test('resolveIngestUrls flattens nested url payloads and dedupes wrappers', () => {
  const payload = {
    urls: [
      'https://example.com/redirect?url=https%3A%2F%2Fwww.canada.ca%2Fen%2Fimmigration-refugees-citizenship%2Fservices%2Fstudy-canada%2Fstudy-permit.html&utm_source=test',
      [
        'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html#eligibility',
        {
          href: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html?utm_medium=email',
        },
      ],
    ],
  };

  const urls = resolveIngestUrls(payload);

  assert.equal(urls.length, 1);
  assert.equal(
    urls[0],
    'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html'
  );
});

test('resolveIngestUrls dedupes query-order variants and ignores invalid entries', () => {
  const payload = {
    urls: [
      'https://www.canada.ca/en/immigration.html?a=1&b=2',
      'https://www.canada.ca/en/immigration.html?b=2&a=1',
      'not-a-url',
      '',
      null,
      123,
    ],
  };

  const urls = resolveIngestUrls(payload);

  assert.equal(urls.length, 1);
  assert.equal(urls[0], 'https://www.canada.ca/en/immigration.html?a=1&b=2');
});

test('resolveIngestUrls supports single url field', () => {
  const payload = {
    url: 'https://www.canada.ca/en/immigration-refugees-citizenship.html',
  };

  const urls = resolveIngestUrls(payload);

  assert.equal(urls.length, 1);
  assert.equal(urls[0], 'https://www.canada.ca/en/immigration-refugees-citizenship.html');
});

