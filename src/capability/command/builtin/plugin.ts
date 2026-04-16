import type {CodaraCommandDefinition} from '@capability/command/runtime/types';
import {installPluginSkills, listSupportedPluginSpecs} from '@capability/command/catalog/plugin-install';
import {BUILTIN_SOURCE} from './formatters';

export const pluginCommand: CodaraCommandDefinition = {
  name: 'plugin',
  usage: '/plugin install <plugin>@<source> | <git-url>',
  description: 'Install skills from a known plugin or any git repository.',
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
          '       /plugin install <git-url>',
          `Known plugins: ${listSupportedPluginSpecs().join(', ')}`,
          'Or install from any git repo with a skills/ directory.',
        ].join('\n'),
      };
    }

    const spec = command.args[1]?.trim();
    if (!spec) {
      return {
        ok: false,
        command: command.name,
        output: 'Usage: /plugin install <plugin>@<source> or <git-url>',
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
