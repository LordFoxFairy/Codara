import type {CodaraCommandDefinition} from '@capability/command/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

export const compactCommand: CodaraCommandDefinition = {
  name: 'compact',
  usage: '/compact [instructions] | /compact checkpoints [keepLast]',
  description: 'Compact the current conversation context, or prune stored checkpoint history.',
  source: BUILTIN_SOURCE,
  help: {
    executionMode: 'runtime_command',
  },
  async execute({command, agent}) {
    const target = command.args[0]?.toLowerCase();
    if (target === 'checkpoints') {
      const keepLast = normalizeKeepLast(command.args[1]);
      await agent.compactCheckpoints(typeof keepLast === 'number' ? {keepLast} : undefined);
      return {
        ok: true,
        command: command.name,
        output: typeof keepLast === 'number'
          ? `Checkpoint history compacted. Kept the latest ${keepLast} snapshots.`
          : 'Checkpoint history compacted with the default retention policy.',
      };
    }

    try {
      const state = await agent.compactConversation(command.argsText ? {instructions: command.argsText} : undefined);
      return {
        ok: true,
        command: command.name,
        output: 'Conversation context compacted.',
        state,
      };
    } catch (error) {
      return {
        ok: false,
        command: command.name,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

function normalizeKeepLast(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
