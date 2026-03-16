import type {CodaraCommandDefinition} from '@capability/command/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

export const contextCommand: CodaraCommandDefinition = {
  name: 'context',
  usage: '/context',
  description: 'Show context window usage breakdown.',
  source: BUILTIN_SOURCE,
  help: {executionMode: 'runtime_command'},
  async execute({command, agent}) {
    const state = agent.getState();
    const ctx = state.metadata?.contextWindow;

    if (!ctx) {
      return {ok: true, command: command.name, output: 'Context window data not available.'};
    }

    const percent = Math.round(ctx.usagePercent);
    const barLength = 40;
    const filled = Math.round(barLength * percent / 100);
    const bar = '#'.repeat(filled) + '-'.repeat(barLength - filled);

    const lines = [
      'Context window:',
      `  [${bar}] ${percent}%`,
      `  Used: ${ctx.estimatedInputTokens} / ${ctx.maxInputTokens} tokens`,
      `  Available: ${ctx.availableInputTokens} tokens`,
      ctx.overBudget ? '  WARNING: Over budget — consider /compact' : '',
    ].filter(Boolean);

    return {ok: true, command: command.name, output: lines.join('\n')};
  },
};
