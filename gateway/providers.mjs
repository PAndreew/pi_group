export const providers = new Map([
  ['openai', { url: 'https://api.openai.com/v1/chat/completions', limit: 'max_completion_tokens' }],
  ['openrouter', { url: 'https://openrouter.ai/api/v1/chat/completions', limit: 'max_tokens' }],
  ['gemini', { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', limit: 'max_tokens' }],
  ['zhipu', { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', limit: 'max_tokens' }],
  ['anthropic', { url: 'https://api.anthropic.com/v1/messages', limit: 'max_tokens', native: true }],
]);

export function providerRequest(provider, model, input, limit, secret) {
  const headers = { 'content-type': 'application/json' };
  if (provider.native) {
    headers['x-api-key'] = secret;
    headers['anthropic-version'] = '2023-06-01';
  } else headers.authorization = `Bearer ${secret}`;
  const payload = { model, messages: input.messages, [provider.limit]: limit, stream: input.stream === true };
  const fields = provider.native
    ? ['system', 'tools', 'tool_choice', 'temperature', 'stop_sequences']
    : ['tools', 'tool_choice', 'parallel_tool_calls', 'response_format', 'temperature', 'reasoning_effort', 'stream_options'];
  for (const key of fields) if (input[key] !== undefined) payload[key] = input[key];
  return { headers, payload };
}
