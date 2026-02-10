async function postJson(url, payload, apiKey) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`MCP query error: ${errText}`);
  }

  return response.json();
}

export async function mcpQuery({ query, topK = 6 }) {
  const primaryUrl = process.env.MCP_BASE_URL;
  const secondaryUrl = process.env.MCP_BASE_URL_SECONDARY;
  if (!primaryUrl && !secondaryUrl) {
    return [];
  }

  const apiKey = process.env.MCP_API_KEY;
  const payload = { query, limit: topK };

  let data;
  try {
    data = await postJson(primaryUrl, payload, apiKey);
  } catch (err) {
    if (!secondaryUrl) {
      throw err;
    }
    data = await postJson(secondaryUrl, payload, apiKey);
  }

  const items = data?.items || data?.results || data?.data || [];

  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => ({
    id: item.id || item.caseId || item.documentId || item.slug,
    score: item.score,
    text: item.text || item.snippet || item.summary || '',
    title: item.title || item.caseName || item.name,
    source: item.url || item.source || 'mcp',
    citation: item.citation,
    paragraphNumbers: item.paragraphNumbers || item.paras || []
  }));
}
