import type {CodaraCommandDefinition} from '@capability/command/types';
import {installPluginSkills, listSupportedPluginSpecs} from '@capability/command/plugin-install';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

export const pluginCommand: CodaraCommandDefinition = {
  name: 'plugin',
  usage: '/plugin install <plugin>@<source>',
  description: 'Install a supported Claude-style plugin by importing its skills into Codara.',
  source: BUILTIN_SOURCE,
  help: {
    executionMode: 'runtime_command',
  },
  async execute({command, agent, environment}) {
    const subcommand = command.args[0]?.trim().toLowerCase();
    if (subcommand !== 'install') {
      return {
        ok: false,
        command: command.name,
        output: [
          'Usage: /plugin install <plugin>@<source>',
          `Supported plugin specs: ${listSupportedPluginSpecs().join(', ')}`,
        ].join('\n'),
      };
    }

    const spec = command.args[1]?.trim();
    if (!spec) {
      return {
        ok: false,
        command: command.name,
        output: 'Usage: /plugin install <plugin>@<source>',
      };
    }

    try {
      const result = await installPluginSkills(spec, environment);
      await agent.reloadSources();
      return {
        ok: true,
        command: command.name,
        output: [
          `Imported plugin ${result.plugin}@${result.source} into Codara skills.`,
          `Installed ${result.installedSkills.length} skills into ${result.destinationRoot}.`,
          ...(result.installedSkills.length > 0
            ? [`Skills: ${result.installedSkills.join(', ')}`]
            : []),
          ...(result.skippedSkills.length > 0
            ? [`Skipped existing skills: ${result.skippedSkills.join(', ')}`]
            : []),
          'Session skill sources reloaded.',
        ].join('\n'),
      };
    } catch (error) {
      return {
        ok: false,
        command: command.name,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
