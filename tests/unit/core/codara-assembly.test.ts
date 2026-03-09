import {describe, expect, it} from 'bun:test';
import {resolveCodaraAgentOptions} from '@core/codara/assembly';
import type {ModelRoutingConfig} from '@core/provider';

const config: ModelRoutingConfig = {
  providers: [
    {
      name: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test-openrouter',
      models: [
        {id: 'anthropic/claude-sonnet-4', contextWindow: 200_000, maxOutputTokens: 8_192},
      ],
    },
  ],
  routerRules: [
    {
      alias: 'default',
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      target: 'openrouter:anthropic/claude-sonnet-4',
    },
  ],
};

describe('Codara assembly', () => {
  it('should derive default input budget from model metadata', async () => {
    const resolved = await resolveCodaraAgentOptions({
      config,
      skills: false,
      builtinTools: false,
    });

    expect(resolved.inputBudget).toEqual({
      maxInputTokens: 200_000,
      reservedTokens: 8_192,
    });
  });

  it('should respect explicit input budget overrides over model metadata', async () => {
    const resolved = await resolveCodaraAgentOptions({
      config,
      skills: false,
      builtinTools: false,
      inputBudget: {
        maxInputTokens: 4_096,
        reservedTokens: 1_024,
      },
    });

    expect(resolved.inputBudget).toEqual({
      maxInputTokens: 4_096,
      reservedTokens: 1_024,
    });
  });
});
