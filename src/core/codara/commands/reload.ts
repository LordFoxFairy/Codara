import type {CodaraCommandDefinition} from '@core/codara/commands/types';

export function createReloadCommand(): CodaraCommandDefinition {
  return {
    name: 'reload',
    usage: '/reload',
    description: 'Invalidate session-scoped AGENTS.md caches and reload sources on the next model call.',
    async execute({command, host}) {
      host.reloadSources();
      return {
        ok: true,
        command: command.name,
        output: 'Session source caches cleared. AGENTS.md will be reloaded on the next model call.',
      };
    },
  };
}
