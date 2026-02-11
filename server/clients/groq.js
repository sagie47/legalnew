import OpenAI from 'openai';

export function makeGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');

  return new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
  });
}

export async function groqRespond({
  systemPrompt,
  userPrompt,
  model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  mcpServers = [],
}) {
  const client = makeGroqClient();

  const tools = mcpServers
    .filter((s) => s.url)
    .map((s) => ({
      type: 'mcp',
      server_label: s.label,
      server_url: s.url,
      ...(s.description ? { server_description: s.description } : {}),
      require_approval: s.requireApproval ?? 'never',
      ...(s.headers && Object.keys(s.headers).length ? { headers: s.headers } : {}),
      ...(typeof s.allowedTools !== 'undefined' ? { allowed_tools: s.allowedTools } : {}),
    }));

  const resp = await client.responses.create({
    model,
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    ...(tools.length ? { tools } : {}),
  });

  return {
    text: resp.output_text ?? '',
    raw: resp,
  };
}
