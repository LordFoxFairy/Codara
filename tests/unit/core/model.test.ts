import {describe, expect, it} from 'bun:test';
import {
  createCodaraAgent,
  createCodaraChatModel,
  createCodaraModelCatalog,
  createAgentMemoryCheckpointer,
  loadCodaraAgent,
  type ModelRoutingConfig,
} from '@core';

const baseConfig: ModelRoutingConfig = {
  providers: [
    {
      name: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test-openrouter',
      models: ['anthropic/claude-sonnet-4', 'anthropic/claude-opus-4'],
    },
    {
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test-deepseek',
      models: ['deepseek-chat'],
    },
  ],
  routerRules: [
    {
      alias: 'default',
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      target: 'openrouter:anthropic/claude-sonnet-4',
    },
    {
      alias: 'sonnet',
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      target: 'openrouter:anthropic/claude-sonnet-4',
    },
    {
      alias: 'deepseek',
      provider: 'deepseek',
      model: 'deepseek-chat',
      target: 'deepseek:deepseek-chat',
    },
  ],
};

describe('Codara model facade', () => {
  it('should expose model aliases from the configured default catalog', async () => {
    const catalog = await createCodaraModelCatalog({config: baseConfig});

    expect(catalog.getAliases()).toEqual(['default', 'sonnet', 'deepseek']);
    expect(catalog.hasAlias('default')).toBe(true);
    expect(catalog.getInfo().alias).toBe('default');
    expect(catalog.getInfo('deepseek').provider).toBe('deepseek');
  });

  it('should create a chat model through the default alias when alias is omitted', async () => {
    const model = await createCodaraChatModel({config: baseConfig});
    const internal = model as unknown as {
      _defaultConfig?: {configuration?: {baseURL?: string}; modelProvider?: string};
    };

    expect(typeof model.invoke).toBe('function');
    expect(internal._defaultConfig?.modelProvider).toBe('openai');
    expect(internal._defaultConfig?.configuration?.baseURL).toBe('https://openrouter.ai/api/v1');
  });

  it('should create an alias-backed Codara agent without manual provider wiring', async () => {
    const agent = await createCodaraAgent({
      config: baseConfig,
      alias: 'deepseek',
      skills: false,
    });

    expect(agent.getState().messages).toHaveLength(0);
    expect(agent.getState().threadId.length).toBeGreaterThan(0);
  });

  it('should load an alias-backed Codara agent from checkpoints', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const restored = await loadCodaraAgent({
      config: baseConfig,
      threadId: 'missing-thread',
      checkpointer,
      skills: false,
    });

    expect(restored).toBeUndefined();
  });
});
