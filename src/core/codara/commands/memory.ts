import type {CodaraCommandDefinition, CodaraCommandResult} from '@core/codara/commands/types';

export function createMemoryCommand(): CodaraCommandDefinition {
  return {
    name: 'memory',
    usage: '/memory [show|project|global]',
    description: 'Inspect or prepare the session AGENTS.md memory files for manual editing.',
    source: {type: 'builtin'},
    async execute({command, host}) {
      const subcommand = (command.args[0] ?? 'show').toLowerCase();

      if (subcommand === 'show') {
        const overview = await host.inspectAgentsFiles();
        return {
          ok: true,
          command: command.name,
          output: [
            'AGENTS source stack:',
            ...overview.stack.map((entry) => `- ${entry.scope}: ${formatLoadedState(entry.path, overview.loadedPaths)}`),
            '',
            'Edit targets:',
            `- global: ${overview.globalPath}`,
            `- project: ${overview.projectPath}`,
            '',
            'Choose a target with /memory project or /memory global.',
            'After saving changes, run /reload so the current session picks them up.',
          ].join('\n'),
        };
      }

      if (subcommand === 'project' || subcommand === 'global') {
        const filePath = await host.ensureAgentsFileTarget(subcommand);
        return {
          ok: true,
          command: command.name,
          output: [
            `Edit this ${subcommand} AGENTS.md file:`,
            filePath,
            '',
            'After saving changes, run /reload so the current session picks them up.',
            ...(subcommand === 'project'
              ? ['Use /memory global if you want to edit the global AGENTS.md instead.']
              : ['Use /memory project if you want to edit the project AGENTS.md instead.']),
          ].join('\n'),
          action: {
            type: 'open_file',
            path: filePath,
          },
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
