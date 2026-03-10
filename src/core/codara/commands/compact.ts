import {readSummaryRecord} from '@core/middleware/summary';
import type {CodaraCommandDefinition} from '@core/codara/commands/types';

export function createCompactCommand(): CodaraCommandDefinition {
  return {
    name: 'compact',
    usage: '/compact [instructions] | /compact checkpoints [keepLast]',
    description: 'Compact the current conversation context, or prune stored checkpoint history.',
    source: {type: 'builtin'},
    async execute({command, host}) {
      const target = command.args[0]?.toLowerCase();
      if (target === 'checkpoints') {
        const keepLast = normalizeKeepLast(command.args[1]);
        await host.compactCheckpoints(keepLast);
        return {
          ok: true,
          command: command.name,
          output: typeof keepLast === 'number'
            ? `Checkpoint history compacted. Kept the latest ${keepLast} snapshots.`
            : 'Checkpoint history compacted with the default retention policy.',
        };
      }

      const instructions = command.argsText.trim();
      const nextState = await host.compactConversation({
        ...(instructions ? {instructions} : {}),
      });
      const summary = readSummaryRecord(nextState.messages);

      if (!summary) {
        return {
          ok: true,
          command: command.name,
          output: instructions
            ? `No summary compaction was applied to the current conversation. Instructions were: ${instructions}`
            : 'No summary compaction was applied to the current conversation.',
          state: nextState,
        };
      }

      return {
        ok: true,
        command: command.name,
        output: instructions
          ? `Conversation compacted with custom instructions. Summary now covers ${summary.summarizedMessages} earlier messages.`
          : `Conversation compacted. Summary now covers ${summary.summarizedMessages} earlier messages.`,
        state: nextState,
      };
    },
  };
}

function normalizeKeepLast(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
