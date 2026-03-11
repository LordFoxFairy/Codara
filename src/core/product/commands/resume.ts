import type {CodaraCommandDefinition, CodaraCommandResult} from '@core/product/commands/types';

export function createResumeCommand(): CodaraCommandDefinition {
  return {
    name: 'resume',
    usage: '/resume [approve|reject] [feedback]',
    description: 'Resume the current paused HIL action in the active conversation.',
    aliases: ['continue'],
    source: {type: 'builtin'},
    async execute({command, host}) {
      const state = await host.hydrate();
      if (state.status !== 'paused' || !state.pendingPause) {
        return errorResult(command.name, 'No paused action is waiting for review in the current session.');
      }

      const decision = normalizeResumeDecision(command.args[0]);
      const feedback = decision ? command.args.slice(1).join(' ').trim() : command.args.join(' ').trim();
      const nextState = await host.resumePause({
        decision,
        ...(feedback ? {feedback} : {}),
      });

      return {
        ok: true,
        command: command.name,
        output: decision === 'reject'
          ? 'Paused action rejected and the conversation has resumed.'
          : 'Paused action approved and the conversation has resumed.',
        state: nextState,
      };
    },
  };
}

function normalizeResumeDecision(value: string | undefined): 'approve' | 'reject' {
  if (!value) {
    return 'approve';
  }

  const normalized = value.toLowerCase();
  return normalized === 'reject' || normalized === 'deny'
    ? 'reject'
    : 'approve';
}

function errorResult(command: string, output: string): CodaraCommandResult {
  return {
    ok: false,
    command,
    output,
  };
}
