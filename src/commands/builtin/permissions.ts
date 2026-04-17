import type {CodaraCommandDefinition} from '@commands/types';
import {
  ensurePermissionSettingsFile,
  resolvePermissionSettingsFile,
  validatePermissionSettings,
} from '@core/middleware/permission';
import {BUILTIN_SOURCE} from './formatters';

export const permissionsCommand: CodaraCommandDefinition = {
  name: 'permissions',
  usage: '/permissions [show|edit]',
  description: 'Inspect or open the active permission policy files for this runtime.',
  source: BUILTIN_SOURCE,
  help: {
    executionMode: 'host_action',
  },
  async execute({command, environment}) {
    const target = (command.args[0] ?? 'show').trim().toLowerCase();
    const settingsFile = resolvePermissionSettingsFile(environment);

    if (target === 'edit') {
      ensurePermissionSettingsFile(environment);
      return {
        ok: true,
        command: command.name,
        output: `Open permission settings: ${settingsFile}`,
        action: {
          type: 'open_file',
          path: settingsFile,
        },
      };
    }

    if (target !== 'show') {
      return {
        ok: false,
        command: command.name,
        output: 'Usage: /permissions [show|edit]',
      };
    }

    const results = await validatePermissionSettings(environment);
    return {
      ok: true,
      command: command.name,
      output: [
        'Permission policy sources:',
        ...results.map(formatPermissionSourceResult),
        `Use /permissions edit to open ${settingsFile} in the host shell.`,
      ].join('\n'),
    };
  },
};

function formatPermissionSourceResult(result: Awaited<ReturnType<typeof validatePermissionSettings>>[number]): string {
  const summary = `rules=${result.ruleCount}`;
  const suffix = result.errors.length > 0 ? ` | errors: ${result.errors.join('; ')}` : '';
  return `- ${result.scope}: ${result.path} | status=${result.status} | ${summary}${suffix}`;
}
