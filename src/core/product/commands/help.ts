import type {CodaraCommandDefinition, CodaraCommandResult, CodaraCommandSpec} from '@core/product/commands/types';

export function createHelpCommand(): CodaraCommandDefinition {
  return {
    name: 'help',
    usage: '/help [command]',
    description: 'Show available Codara slash commands.',
    source: {type: 'builtin'},
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
            `Source: ${formatCommandSource(target)}`,
            ...(target.aliases?.length ? [`Aliases: ${target.aliases.map((alias) => `/${alias}`).join(', ')}`] : []),
          ].join('\n'),
        };
      }

      const builtin = registry.filter((item) => item.source.type === 'builtin');
      const skillCommands = registry.filter((item) => item.source.type === 'skill');

      return {
        ok: true,
        command: command.name,
        output: [
          'Available commands:',
          ...builtin.map(formatCommandSummary),
          ...(skillCommands.length > 0
            ? [
                '',
                'Skill commands:',
                ...skillCommands.map(formatCommandSummary),
              ]
            : []),
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
  const suffix = command.source.type === 'skill' ? ` [skill: ${command.source.skillName}]` : '';
  return `- ${command.usage} : ${command.description}${suffix}`;
}

function formatCommandSource(command: CodaraCommandSpec): string {
  if (command.source.type === 'builtin') {
    return 'built-in host command';
  }

  return `skill "${command.source.skillName}" (${command.source.skillPath})`;
}

function errorResult(command: string, output: string): CodaraCommandResult {
  return {
    ok: false,
    command,
    output,
  };
}
