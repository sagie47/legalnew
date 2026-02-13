import { readFileSync } from 'node:fs';
import { join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

let cachedPolicy = null;

export function loadSourcePolicy() {
  if (cachedPolicy) {
    return cachedPolicy;
  }
  
  const configPath = join(__dirname, 'source_policy.v1.json');
  const content = readFileSync(configPath, 'utf-8');
  cachedPolicy = JSON.parse(content);
  return cachedPolicy;
}

export function isUrlAllowed(url, policy = null) {
  const p = policy || loadSourcePolicy();
  
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const pathname = urlObj.pathname;

    if (p.blocked_hosts.includes(hostname)) {
      return { allowed: false, reason: 'HOST_BLOCKED', hostname };
    }

    for (const blockedPrefix of p.blocked_path_prefixes) {
      if (pathname.startsWith(blockedPrefix) || pathname.includes(blockedPrefix)) {
        return { allowed: false, reason: 'PATH_BLOCKED', pathname };
      }
    }

    if (!p.allowed_hosts.includes(hostname)) {
      return { allowed: false, reason: 'HOST_NOT_ALLOWED', hostname };
    }

    const allowedPaths = p.allowed_host_paths[hostname];
    if (allowedPaths && allowedPaths.length > 0) {
      const hasAllowedPath = allowedPaths.some(path => pathname.startsWith(path));
      if (!hasAllowedPath) {
        return { allowed: false, reason: 'PATH_NOT_ALLOWED', hostname, pathname };
      }
    }

    return { allowed: true, reason: 'ALLOWED', hostname };
  } catch (error) {
    return { allowed: false, reason: 'INVALID_URL', error: error.message };
  }
}

export function isDocFamilyAllowed(docFamily, policy = null) {
  const p = policy || loadSourcePolicy();
  
  const allowMap = p.doc_family_allow_map;
  
  if (!allowMap[docFamily]) {
    return { allowed: false, reason: 'UNKNOWN_DOC_FAMILY', docFamily };
  }
  
  const config = allowMap[docFamily];
  
  if (!config.allowed) {
    return { allowed: false, reason: config.reason || 'NOT_ALLOWED', docFamily };
  }
  
  return { 
    allowed: true, 
    reason: 'ALLOWED', 
    docFamily,
    requires_temporal: config.requires_temporal || false,
    authority_level: config.authority_level
  };
}

export function getMaxLiveFetches(docFamily, policy = null) {
  const p = policy || loadSourcePolicy();
  return p.max_live_fetches_by_doc_family[docFamily] || 0;
}
