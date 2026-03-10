import type {CodaraCommandDefinition, CodaraCommandResult} from '@core/codara/commands/types';

export function createMemoryCommand(): CodaraCommandDefinition {
  return {
    name: 'memory',
    usage: '/memory [show|project|global]',
    description: 'Inspect or prepare the session AGENTS.md memory files for manual editing.',
    async execute({command, host}) {
      const subcommand = (command.args[0] ?? 'show').toLowerCase();

      if (subcommand === 'show') {
        const overview = await host.inspectMemory();
        return {
          ok: true,
          command: command.name,
          output: [
            'AGENTS memory stack:',
            `- global: ${formatLoadedState(overview.globalPath, overview.loadedPaths)}`,
            `- project: ${formatLoadedState(overview.projectPath, overview.loadedPaths)}`,
            '',
            'Use /memory project or /memory global to prepare a file for manual editing.',
            'After saving changes, run /reload so the current session picks them up.',
          ].join('\n'),
        };
      }

      if (subcommand === 'project' || subcommand === 'global') {
        const filePath = await host.ensureMemoryTarget(subcommand);
        return {
          ok: true,
          command: command.name,
          output: [
            `Edit this ${subcommand} AGENTS.md file:`,
            filePath,
            '',
            'After saving changes, run /reload so the current session picks them up.',
          ].join('\n'),
          filePath,
        };
      }

      return errorResult(command.name, 'Usage: /memory [show|project|global]');
    },
  };
}

function formatLoadedState(filePath: string, loadedPaths: readonly string[]): string {
  return loadedPaths.includes(filePath)
    ? `${filePath} (loaded)`
    : `${filePath} (not currently loaded)`;
}

function errorResult(command: string, output: string): CodaraCommandResult {
  return {
    ok: false,
    command,
    output,
  };
}
