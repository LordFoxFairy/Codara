import type {CodaraCommandDefinition} from '@commands/runtime/types';
import {formatCost, formatCostSnapshot, formatNumber} from '@cost';
import {BUILTIN_SOURCE, formatTokens} from './formatters';

export const costCommand: CodaraCommandDefinition = {
  name: 'cost',
  usage: '/cost',
  description: 'Show token usage and estimated cost for this session.',
  source: BUILTIN_SOURCE,
  help: {executionMode: 'runtime_command'},
  async execute({command, agent, environment}) {
    // Prefer the CostTracker snapshot (has pricing-based cost estimates + per-model breakdown)
    const snapshot = agent.getCostSnapshot?.();
    if (snapshot && snapshot.totalCalls > 0) {
      const header = `Session cost summary (model: ${environment.modelAlias ?? 'default'})`;
      return {ok: true, command: command.name, output: `${header}\n${formatCostSnapshot(snapshot)}`};
    }

    // Fallback to session metadata usage (basic token counts without cost estimates)
    const state = agent.getState();
    const usage = state.metadata?.usage;

    if (!usage) {
      return {ok: true, command: command.name, output: 'No usage data available yet.'};
    }

    const lines = [
      'Session cost summary:',
      `  Model: ${environment.modelAlias ?? 'default'}`,
      `  API calls: ${usage.modelCalls ?? 0}`,
      `  Input tokens: ${formatTokens(usage.promptTokens ?? 0)}`,
      `  Output tokens: ${formatTokens(usage.completionTokens ?? 0)}`,
      `  Total tokens: ${formatTokens(usage.totalTokens ?? 0)}`,
    ];

    return {ok: true, command: command.name, output: lines.join('\n')};
  },
};
