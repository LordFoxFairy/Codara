import type {CodaraCommandDefinition} from '@commands/types';
import type {ConversationCompactionResult} from '@state/session';
import {BUILTIN_SOURCE} from './formatters';

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
      const compacted = await agent.compactConversation(command.argsText ? {instructions: command.argsText} : undefined);
      return {
        ok: true,
        command: command.name,
        output: describeCompactOutcome(compacted),
        state: compacted.state,
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

function describeCompactOutcome(result: ConversationCompactionResult): string {
  if (result.outcome === 'compacted') {
    return 'Conversation context compacted.';
  }

  return result.reason === 'hook'
    ? 'Conversation compaction skipped by hook.'
    : 'Conversation context already compact enough.';
}
