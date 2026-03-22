import {describe, expect, it} from 'bun:test';
import {compactCommand} from '@capability/command/builtin/compact';
import type {
  CodaraCommandAgent,
  CodaraCommandContext,
  ParsedCodaraCommand,
} from '@capability/command/runtime/types';

function makeIdleAgentState() {
  return {
    sessionId: 'session-1',
    agentType: 'main' as const,
    messages: [],
    context: {},
    values: {},
    status: 'idle' as const,
  };
}

function makeContext(agentOverrides: Partial<CodaraCommandAgent> = {}, args: string[] = []): CodaraCommandContext {
  const command: ParsedCodaraCommand = {
    raw: `/compact ${args.join(' ')}`.trim(),
    name: 'compact',
    args,
    argsText: args.join(' '),
  };

  return {
    command,
    registry: [],
    agent: {
      compactConversation: async () => ({
        state: makeIdleAgentState(),
        outcome: 'compacted',
      }),
      compactCheckpoints: async () => undefined,
      getAvailableToolNames: () => [],
      hydrate: async () => makeIdleAgentState(),
      getAgentState: () => makeIdleAgentState(),
      getState: () => ({sessionId: 'session-1', sessionStatus: 'ready'}),
      invoke: async () => ({reason: 'complete', state: makeIdleAgentState(), turns: 1}),
      reloadSources: async () => undefined,
      reset: async () => undefined,
      ...agentOverrides,
    } as CodaraCommandAgent,
    environment: {},
  };
}

describe('/compact command', () => {
  it('reports a real compaction as compacted', async () => {
    const result = await compactCommand.execute(makeContext({
      compactConversation: async () => ({
        state: makeIdleAgentState(),
        outcome: 'compacted',
      }),
    }));

    expect(result.ok).toBe(true);
    expect(result.output).toBe('Conversation context compacted.');
  });

  it('reports hook-vetoed compaction as skipped by hook', async () => {
    const result = await compactCommand.execute(makeContext({
      compactConversation: async () => ({
        state: makeIdleAgentState(),
        outcome: 'skipped',
        reason: 'hook',
      }),
    }));

    expect(result.ok).toBe(true);
    expect(result.output).toBe('Conversation compaction skipped by hook.');
  });

  it('reports noop compaction as already compact enough', async () => {
    const result = await compactCommand.execute(makeContext({
      compactConversation: async () => ({
        state: makeIdleAgentState(),
        outcome: 'skipped',
        reason: 'noop',
      }),
    }));

    expect(result.ok).toBe(true);
    expect(result.output).toBe('Conversation context already compact enough.');
  });
});
