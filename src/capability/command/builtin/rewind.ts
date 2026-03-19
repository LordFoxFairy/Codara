import type {CodaraCommandDefinition} from '@capability/command/runtime/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

export const rewindCommand: CodaraCommandDefinition = {
  name: 'rewind',
  usage: '/rewind [n]',
  description: 'Rewind conversation by removing the last N turn pairs (default 1).',
  source: BUILTIN_SOURCE,
  help: {executionMode: 'runtime_command'},
  async execute({command, agent}) {
    const n = parseInt(command.argsText.trim() || '1', 10);
    if (isNaN(n) || n < 1) {
      return {ok: false, command: command.name, output: 'Usage: /rewind [n] — n must be a positive integer.'};
    }

    const state = await agent.hydrate();
    const messages = state.messages;

    let removed = 0;
    let i = messages.length - 1;
    while (i >= 0 && removed < n) {
      while (i >= 0 && messages[i]!.type === 'tool') i--;
      if (i >= 0 && messages[i]!.type === 'ai') i--;
      if (i >= 0 && messages[i]!.type === 'human') i--;
      removed++;
    }

    const remainingCount = Math.max(0, i + 1);
    const removedCount = messages.length - remainingCount;

    if (removedCount === 0) {
      return {ok: true, command: command.name, output: 'Nothing to rewind.'};
    }

    if ('rewind' in agent && typeof (agent as unknown as Record<string, unknown>).rewind === 'function') {
      await (agent as unknown as {rewind: (count: number) => Promise<void>}).rewind(remainingCount);
      return {
        ok: true,
        command: command.name,
        output: `Rewound ${removed} turn(s), removed ${removedCount} messages.`,
      };
    }

    return {
      ok: false,
      command: command.name,
      output: 'Rewind not supported in current session configuration.',
    };
  },
};
