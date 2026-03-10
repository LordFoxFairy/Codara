import {readSummaryRecord} from '@core/middleware/summary';
import type {CodaraCommandDefinition} from '@core/codara/commands/types';

export function createCompactCommand(): CodaraCommandDefinition {
  return {
    name: 'compact',
    usage: '/compact',
    description: 'Compact the current conversation context using the configured summary lifecycle.',
    async execute({command, host}) {
      const nextState = await host.compactConversation();
      const summary = readSummaryRecord(nextState.messages);

      if (!summary) {
        return {
          ok: true,
          command: command.name,
          output: 'No summary compaction was applied to the current conversation.',
          state: nextState,
        };
      }

      return {
        ok: true,
        command: command.name,
        output: `Conversation compacted. Summary now covers ${summary.summarizedMessages} earlier messages.`,
        state: nextState,
      };
    },
  };
}
