import type {CodaraCommandDefinition, CodaraCommandResult, CodaraCommandSpec} from '@core/codara/commands/types';

export function createHelpCommand(): CodaraCommandDefinition {
  return {
    name: 'help',
    usage: '/help [command]',
    description: 'Show built-in Codara slash commands.',
    async execute({command, registry}) {
      const targetName = command.args[0]?.toLowerCase();
      if (targetName) {
        const target = findCommand(registry, targetName);
        if (!target) {
          return errorResult(command.name, `Unknown command: /${targetName}`);
        }

        return {
          ok: true,
          command: command.name,
          output: [
            `/${target.name}`,
            target.description,
            `Usage: ${target.usage}`,
            ...(target.aliases?.length ? [`Aliases: ${target.aliases.map((alias) => `/${alias}`).join(', ')}`] : []),
          ].join('\n'),
        };
      }

      return {
        ok: true,
        command: command.name,
        output: [
          'Available commands:',
          ...registry.map(formatCommandSummary),
        ].join('\n'),
      };
    },
  };
}

function findCommand(
  registry: readonly CodaraCommandDefinition[],
  name: string,
): CodaraCommandDefinition | undefined {
  const normalized = name.toLowerCase();
  return registry.find((command) =>
    command.name === normalized || command.aliases?.some((alias) => alias.toLowerCase() === normalized),
  );
}

function formatCommandSummary(command: CodaraCommandSpec): string {
  return `- ${command.usage} : ${command.description}`;
}

function errorResult(command: string, output: string): CodaraCommandResult {
  return {
    ok: false,
    command,
    output,
  };
}
