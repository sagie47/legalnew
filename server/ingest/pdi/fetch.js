import { load } from 'cheerio';
import { gotScraping } from 'got-scraping';

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8';

function normalizeUrl(raw, base) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const u = new URL(raw, base);
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function findCanonicalUrl(html, baseUrl) {
  try {
    const $ = load(html);
    const href = $('link[rel="canonical"]').attr('href');
    return normalizeUrl(href, baseUrl);
  } catch {
    return null;
  }
}

export async function fetchPdiHtml(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const normalizedInput = normalizeUrl(url);
  if (!normalizedInput) {
    throw new Error(`Invalid URL: ${url}`);
  }

  const attempts = [
    {
      label: 'chrome_http2',
      options: {
        http2: true,
        headerGeneratorOptions: {
          browsers: [{ name: 'chrome', minVersion: 110 }],
          devices: ['desktop'],
          locales: ['en-CA', 'en-US'],
        },
      },
    },
    {
      label: 'chrome_http1',
      options: {
        http2: false,
        headerGeneratorOptions: {
          browsers: [{ name: 'chrome', minVersion: 110 }],
          devices: ['desktop'],
          locales: ['en-CA', 'en-US'],
        },
      },
    },
  ];

  let response = null;
  const errors = [];
  for (const attempt of attempts) {
    try {
      response = await gotScraping({
        url: normalizedInput,
        method: 'GET',
        followRedirect: true,
        throwHttpErrors: false,
        timeout: {
          request: timeoutMs,
        },
        retry: {
          limit: 1,
        },
        headers: {
          Referer: 'https://www.google.com/',
          Accept: DEFAULT_ACCEPT,
        },
        ...attempt.options,
      });

      if (!response || response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`Fetch failed (${response?.statusCode ?? 'no-status'})`);
      }

      break;
    } catch (error) {
      errors.push(`${attempt.label}: ${error?.message || error}`);
      response = null;
    }
  }

  if (!response) {
    throw new Error(`All fetch attempts failed: ${errors.join(' | ')}`);
  }

  const contentTypeHeader = response.headers['content-type'];
  const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : (contentTypeHeader || '');
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    throw new Error(`Unsupported content-type: ${contentType}`);
  }

  const html = response.body || '';
  const fetchedUrl = normalizeUrl(response.url) || normalizedInput;
  const canonicalUrl = findCanonicalUrl(html, fetchedUrl);
  const sourceUrl = canonicalUrl || fetchedUrl;

  return {
    requestUrl: normalizedInput,
    fetchedUrl,
    sourceUrl,
    html,
  };
}

export function canonicalizeForHash(url) {
  const normalized = normalizeUrl(url);
  return normalized || String(url || '').trim();
}
