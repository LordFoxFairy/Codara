import type {CodaraCommandDefinition} from '@core/commands/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

export const reloadCommand: CodaraCommandDefinition = {
  name: 'reload',
  usage: '/reload',
  description: 'Invalidate session-scoped codara.md, AGENTS.md, and skills caches and reload sources on the next model call.',
  source: BUILTIN_SOURCE,
  help: {
    executionMode: 'runtime_command',
  },
  async execute({command, agent}) {
    await agent.reloadSources();

    // Reload hooks
    if (agent.hookRegistry) {
      await agent.hookRegistry.reload();
    }

    return {
      ok: true,
      command: command.name,
      output: 'Session source caches cleared. codara.md, AGENTS.md, skills, and hooks will be reloaded on the next model call.',
    };
  },
};
