import type {CodaraCommandDefinition} from '@core/commands/types';

export function createReloadCommand(): CodaraCommandDefinition {
  return {
    name: 'reload',
    usage: '/reload',
    description: 'Invalidate session-scoped AGENTS.md caches and reload sources on the next model call.',
    source: {type: 'builtin'},
    async execute({command, host}) {
      await host.reloadSources();
      return {
        ok: true,
        command: command.name,
        output: 'Session source caches cleared. AGENTS.md will be reloaded on the next model call.',
      };
    },
  };
}
