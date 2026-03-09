import {describe, expect, it} from 'bun:test';
import {
  createCodara,
  createMiddleware,
  createCodaraChatModel,
  createCodaraModelCatalog,
  createAgentMemoryCheckpointer,
  type ModelRoutingConfig,
} from '@core';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {BeforeModelContext} from '@core/middleware';
import {EchoModel} from './codara-fixtures';

const baseConfig: ModelRoutingConfig = {
  providers: [
    {
      name: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test-openrouter',
      models: [
        {id: 'anthropic/claude-sonnet-4', contextWindow: 200_000, maxOutputTokens: 8_192},
        {id: 'anthropic/claude-opus-4'},
      ],
    },
    {
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test-deepseek',
      models: [{id: 'deepseek-chat', contextWindow: 64_000, maxOutputTokens: 8_000}],
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
    expect(catalog.getInfo('sonnet').contextWindow).toBe(200_000);
    expect(catalog.getInfo('deepseek').maxOutputTokens).toBe(8_000);
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
    const codara = createCodara({
      config: baseConfig,
      alias: 'deepseek',
      skills: false,
    });

    // Trigger agent initialization
    await codara.invoke('test');

    expect(codara.getAgentState().messages.length).toBeGreaterThan(0);
    expect(codara.getState().threadId.length).toBeGreaterThan(0);
  });

  it('should load an alias-backed Codara agent from checkpoints', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const codara = createCodara({
      config: baseConfig,
      threadId: 'missing-thread',
      checkpointer,
      restore: 'latest',
      skills: false,
    });

    // When no checkpoint exists, session should still be created
    const state = codara.getState();
    expect(state.threadId).toBe('missing-thread');
    expect(state.sessionStatus).toBe('ready');
  });

  it('should derive input budget from catalog model metadata for Codara sessions', async () => {
    let seenBudget: BeforeModelContext['inputBudget'];
    const budgetProbe = createMiddleware({
      name: 'budget-probe',
      beforeModel(context) {
        seenBudget = context.inputBudget;
      },
    });

    const catalog = {
      async create() {
        return new EchoModel() as unknown as BaseChatModel;
      },
      getInfo() {
        return {
          alias: 'default',
          provider: 'test',
          model: 'echo',
          target: 'test:echo',
          contextWindow: 12_000,
          maxOutputTokens: 1_024,
        };
      },
      hasAlias() {
        return true;
      },
      getAliases() {
        return ['default'];
      },
    };

    const codara = createCodara({
      catalog: catalog as never,
      skills: false,
      builtinTools: false,
      middleware: [budgetProbe],
    });

    await codara.invoke('hello');

    expect(seenBudget).toEqual({
      maxInputTokens: 12_000,
      reservedTokens: 1_024,
    });
  });

  it('should respect explicit input budget overrides over catalog model metadata', async () => {
    let seenBudget: BeforeModelContext['inputBudget'];
    const budgetProbe = createMiddleware({
      name: 'budget-probe',
      beforeModel(context) {
        seenBudget = context.inputBudget;
      },
    });

    const catalog = {
      async create() {
        return new EchoModel() as unknown as BaseChatModel;
      },
      getInfo() {
        return {
          alias: 'default',
          provider: 'test',
          model: 'echo',
          target: 'test:echo',
          contextWindow: 12_000,
          maxOutputTokens: 1_024,
        };
      },
      hasAlias() {
        return true;
      },
      getAliases() {
        return ['default'];
      },
    };

    const codara = createCodara({
      catalog: catalog as never,
      skills: false,
      builtinTools: false,
      middleware: [budgetProbe],
      inputBudget: {
        maxInputTokens: 4_096,
        reservedTokens: 512,
      },
    });

    await codara.invoke('hello');

    expect(seenBudget).toEqual({
      maxInputTokens: 4_096,
      reservedTokens: 512,
    });
  });
});
