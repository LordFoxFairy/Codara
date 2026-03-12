import type {CodaraCommandDefinition, CodaraCommandSpec} from '@core/commands/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

export const helpCommand: CodaraCommandDefinition = {
  name: 'help',
  usage: '/help [command]',
  description: 'Show available Codara slash commands.',
  source: BUILTIN_SOURCE,
  async execute({command, registry}) {
    const targetName = command.args[0]?.toLowerCase();
    if (!targetName) {
      const builtIns = registry.filter((item) => item.source.type === 'builtin');
      const skillCommands = registry.filter((item) => item.source.type === 'skill');

      return {
        ok: true,
        command: command.name,
        output: [
          'Available commands:',
          ...builtIns.map(formatCommandSummary),
          ...(skillCommands.length > 0
            ? ['', 'Skill commands:', ...skillCommands.map(formatCommandSummary)]
            : []),
        ].join('\n'),
      };
    }

    const target = resolveCommand(registry, targetName);
    if (!target) {
      return {ok: false, command: command.name, output: `Unknown command: /${targetName}`};
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
  },
};

function resolveCommand(
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
  return command.source.type === 'builtin'
    ? 'built-in Codara agent command'
    : `skill "${command.source.skillName}" (${command.source.skillPath})`;
}
