const LINE_INJECTION_PATTERNS = [
  /ignore\s+(all|any|the|previous|prior|above)\s+instructions?/i,
  /disregard\s+(all|any|the|previous|prior|above)\s+instructions?/i,
  /follow\s+these\s+instructions\s+instead/i,
  /you\s+are\s+now/i,
  /system\s+prompt/i,
  /developer\s+message/i,
  /reveal\s+.*\b(prompt|instruction|policy)\b/i,
  /show\s+.*\b(prompt|instruction|policy)\b/i,
  /print\s+.*\b(prompt|instruction|policy)\b/i,
  /begin\s+system\s+prompt/i,
  /end\s+system\s+prompt/i,
  /jailbreak/i,
  /\bDAN\b/i,
  /<\s*system\s*>/i,
  /<\s*assistant\s*>/i,
];

const RCIC_DOMAIN_PATTERNS = [
  /\bircc\b/i,
  /\bcanada(?:n)?\s+immigration\b/i,
  /\bimmigration\b/i,
  /\brefugee\b/i,
  /\basylum\b/i,
  /\bjudicial\s+review\b/i,
  /\bfederal\s+court\b/i,
  /\bfca\b/i,
  /\birpa\b/i,
  /\birpr\b/i,
  /\bpdi\b/i,
  /\bspousal\s+sponsorship\b/i,
  /\bstudy\s+permit\b/i,
  /\bwork\s+permit\b/i,
  /\bvisitor\s+visa\b/i,
  /\bpr\b/i,
  /\bpermanent\s+residen(?:ce|t)\b/i,
  /\bcitizenship\b/i,
  /\bh&c\b/i,
  /\bprocedural\s+fairness\b/i,
  /\bvavilov\b/i,
];

function toText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, ' ').trim();
}

export function detectPromptInjection(message) {
  const text = toText(message);
  const lines = text.split('\n');
  const matched = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const pattern of LINE_INJECTION_PATTERNS) {
      if (pattern.test(trimmed)) {
        matched.push(trimmed.slice(0, 220));
        break;
      }
    }
  }

  const uniqueMatches = Array.from(new Set(matched));
  const score = uniqueMatches.length;
  return {
    detected: score > 0,
    score,
    matches: uniqueMatches,
  };
}

export function sanitizeUserMessage(message, maxChars = 4000) {
  const text = toText(message);
  if (!text) return '';

  const lines = text.split('\n');
  const kept = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const isInjectionLine = LINE_INJECTION_PATTERNS.some((pattern) => pattern.test(trimmed));
    if (isInjectionLine) continue;
    kept.push(trimmed);
  }

  const cleaned = (kept.length > 0 ? kept.join('\n') : text).slice(0, maxChars);
  return cleaned.trim();
}

export function isRcicRelatedQuery(message) {
  const text = toText(message);
  if (!text) return false;
  return RCIC_DOMAIN_PATTERNS.some((pattern) => pattern.test(text));
}

