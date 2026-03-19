import {describe, test, expect} from 'bun:test';
import {costCommand} from '@capability/command/builtin/cost';

describe('/cost command', () => {
  test('shows token usage summary', async () => {
    const result = await costCommand.execute({
      command: {raw: '/cost', name: 'cost', args: [], argsText: ''},
      registry: [],
      agent: {
        getState: () => ({
          sessionId: 'test',
          sessionStatus: 'open',
          metadata: {
            usage: {
              modelCalls: 5,
              promptTokens: 15000,
              completionTokens: 3000,
              totalTokens: 18000,
            },
          },
        }),
        hydrate: async () => ({status: 'idle', messages: []}),
      } as unknown as import('@capability/command/runtime/types').CodaraCommandAgent,
      environment: {modelAlias: 'default'},
    });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('15');
    expect(result.output).toContain('3');
    expect(result.output).toContain('5');
  });

  test('handles missing usage data', async () => {
    const result = await costCommand.execute({
      command: {raw: '/cost', name: 'cost', args: [], argsText: ''},
      registry: [],
      agent: {
        getState: () => ({sessionId: 'test', sessionStatus: 'open'}),
        hydrate: async () => ({status: 'idle', messages: []}),
      } as unknown as import('@capability/command/runtime/types').CodaraCommandAgent,
      environment: {},
    });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('No usage data');
  });
});
