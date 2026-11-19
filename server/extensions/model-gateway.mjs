const alias = 'beezy-personal';
export default function (pi) {
  let previous;
  pi.registerCommand('beezy-gateway-run', {
    description: 'Configure the Beezy gateway for the next run',
    async handler(args, ctx) {
      const { provider, model, token } = JSON.parse(Buffer.from(args, 'base64url').toString());
      if (!ctx.isIdle()) throw new Error('Gateway requires an idle agent');
      previous = ctx.model;
      const native = provider === 'anthropic';
      const url = process.env.BEEZY_GATEWAY_URL.replace(/\/+$/, '');
      pi.registerProvider(alias, {
        api: native ? 'anthropic-messages' : 'openai-completions',
        baseUrl: native ? url : `${url}/v1`, apiKey: token,
        models: [{ id: model, name: `${model} (personal)`, reasoning: false, input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 4096,
          ...(!native && { compat: { maxTokensField: provider === 'openai' ? 'max_completion_tokens' : 'max_tokens', supportsDeveloperRole: false, supportsStore: false } }) }],
      });
    },
  });
  pi.registerCommand('beezy-gateway-clear', {
    description: 'Clear the Beezy gateway run',
    async handler() {
      if (previous) await pi.setModel(previous);
      previous = undefined;
      pi.unregisterProvider(alias);
    },
  });
}
