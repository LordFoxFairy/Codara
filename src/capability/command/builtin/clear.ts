import type {CodaraCommandDefinition} from '@capability/command/runtime/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

export const clearCommand: CodaraCommandDefinition = {
  name: 'clear',
  usage: '/clear',
  description: 'Clear the current conversation state and keep the session ready for a new prompt.',
  source: BUILTIN_SOURCE,
  help: {
    executionMode: 'runtime_command',
  },
  async execute({command, agent}) {
    await agent.reset();
    return {
      ok: true,
      command: command.name,
      output: 'Conversation cleared. Session is ready for a new prompt.',
    };
  },
};
