import type {CodaraCommandDefinition} from '@core/commands/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

export const reloadCommand: CodaraCommandDefinition = {
  name: 'reload',
  usage: '/reload',
  description: 'Invalidate session-scoped AGENTS.md caches and reload sources on the next model call.',
  source: BUILTIN_SOURCE,
  async execute({command, agent}) {
    await agent.reloadSources();
    return {
      ok: true,
      command: command.name,
      output: 'Session source caches cleared. AGENTS.md will be reloaded on the next model call.',
    };
  },
};
