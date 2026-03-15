import type {CodaraCommandDefinition} from '@capability/command/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

export const resumeCommand: CodaraCommandDefinition = {
  name: 'resume',
  usage: '/resume [sessionId]',
  description: 'Reopen a stored conversation. Without args, shows a session picker.',
  source: BUILTIN_SOURCE,
  help: {
    executionMode: 'host_action',
  },
  async execute({command, agent}) {
    const sessionId = command.args[0]?.trim();
    if (!sessionId) {
      return {
        ok: true,
        command: command.name,
        output: '',
        action: {
          type: 'show_session_picker',
        },
      };
    }

    const state = await agent.hydrate();
    const output = state.sessionId === sessionId
      ? `Already using session ${sessionId}.`
      : `Reopening session ${sessionId}.`;

    return {
      ok: true,
      command: command.name,
      output,
      action: {
        type: 'resume_session',
        sessionId,
      },
    };
  },
};
