import {describe, expect, it} from 'bun:test';
import {createAgentMemoryCheckpointer} from '@core/checkpoint';
import {mergeCodaraAgentOptions} from '@core/codara/options';

describe('Codara option merge', () => {
  it('should keep session host option layering separate from runtime assembly', () => {
    const defaultCheckpointer = createAgentMemoryCheckpointer();
    const merged = mergeCodaraAgentOptions(
      {
        threadId: 'base-thread',
        builtinTools: true,
        summary: {maxMessages: 10, summarize: async () => 'summary'},
        skills: {
          cwd: '/workspace/base',
          sources: ['base'],
        },
      },
      {
        builtinTools: false,
        middleware: [],
        skills: {
          agentRoots: ['override-agents'],
        },
      },
      defaultCheckpointer
    );

    expect(merged.threadId).toBe('base-thread');
    expect(merged.builtinTools).toBe(false);
    expect(merged.middleware).toEqual([]);
    expect(merged.summary).toEqual({maxMessages: 10, summarize: expect.any(Function)});
    expect(merged.skills).toEqual({
      cwd: '/workspace/base',
      sources: ['base'],
      agentRoots: ['override-agents'],
    });
    expect(merged.checkpointer).toBe(defaultCheckpointer);
  });

  it('should allow disabling skills explicitly', () => {
    const merged = mergeCodaraAgentOptions(
      {
        skills: {
          cwd: '/workspace/base',
        },
      },
      {
        skills: false,
      },
      createAgentMemoryCheckpointer()
    );

    expect(merged.skills).toBe(false);
  });
});
