import type {CodaraCommandDefinition} from '@core/commands/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

export const resumeCommand: CodaraCommandDefinition = {
  name: 'resume',
  usage: '/resume [approve|reject] [feedback]',
  description: 'Resume the current paused HIL action in the active conversation.',
  aliases: ['continue'],
  source: BUILTIN_SOURCE,
  async execute({command, agent}) {
    const state = await agent.hydrate();
    if (state.status !== 'paused' || !state.pendingPause) {
      return {
        ok: false,
        command: command.name,
        output: 'No paused action is waiting for review in the current session.',
      };
    }

    const decision = normalizeResumeDecision(command.args[0]);
    const feedback = decision ? command.args.slice(1).join(' ').trim() : command.args.join(' ').trim();
    const result = await agent.resumePause(
      {decision},
      feedback ? {input: feedback} : undefined,
    );

    return {
      ok: true,
      command: command.name,
      output: decision === 'reject'
        ? 'Paused action rejected and the conversation has resumed.'
        : 'Paused action approved and the conversation has resumed.',
      state: result.state,
    };
  },
};

function normalizeResumeDecision(value: string | undefined): 'approve' | 'reject' {
  const normalized = value?.toLowerCase();
  return normalized === 'reject' || normalized === 'deny' ? 'reject' : 'approve';
}
