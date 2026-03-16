import type {CodaraCommandDefinition} from '@capability/command/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

export const configCommand: CodaraCommandDefinition = {
  name: 'config',
  usage: '/config [key] [value]',
  description: 'View or modify runtime configuration.',
  source: BUILTIN_SOURCE,
  help: {executionMode: 'runtime_command'},
  async execute({command, agent, environment}) {
    const args = command.argsText.trim();

    if (!args) {
      const lines = [
        'Current configuration:',
        `  cwd: ${environment.cwd ?? process.cwd()}`,
        `  model: ${environment.modelAlias ?? 'default'}`,
        `  projectRoot: ${environment.projectRoot ?? 'auto-detected'}`,
      ];
      return {ok: true, command: command.name, output: lines.join('\n')};
    }

    return {
      ok: false,
      command: command.name,
      output: 'Runtime config modification not yet supported. Edit .codara/config.json directly.',
    };
  },
};
