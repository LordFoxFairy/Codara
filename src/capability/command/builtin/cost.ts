import type {CodaraCommandDefinition} from '@capability/command/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export const costCommand: CodaraCommandDefinition = {
  name: 'cost',
  usage: '/cost',
  description: 'Show token usage and estimated cost for this session.',
  source: BUILTIN_SOURCE,
  help: {executionMode: 'runtime_command'},
  async execute({command, agent, environment}) {
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
