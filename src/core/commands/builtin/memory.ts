import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {resolveWorkspaceRoot} from '@core/shared/workspace';
import type {CodaraCommandDefinition} from '@core/commands/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;
const MEMORY_FILE_NAME = 'AGENTS.md';

export const memoryCommand: CodaraCommandDefinition = {
  name: 'memory',
  usage: '/memory [show|project|global]',
  description: 'Inspect or open the current AGENTS.md memory scopes for this runtime.',
  source: BUILTIN_SOURCE,
  async execute({command, environment}) {
    const target = (command.args[0] ?? 'show').trim().toLowerCase();
    const files = resolveMemoryFiles(environment);

    if (target === 'show') {
      return {
        ok: true,
        command: command.name,
        output: [
          'Memory scopes:',
          formatMemoryScope('project', files.project),
          formatMemoryScope('global', files.global),
          'Use /memory project or /memory global to open a file in the host shell.',
        ].join('\n'),
      };
    }

    if (target === 'project' || target === 'global') {
      const filePath = files[target];
      return {
        ok: true,
        command: command.name,
        output: `Open ${target} memory: ${filePath}`,
        action: {
          type: 'open_file',
          path: filePath,
        },
      };
    }

    return {
      ok: false,
      command: command.name,
      output: 'Usage: /memory [show|project|global]',
    };
  },
};

function resolveMemoryFiles(environment: {
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
}): {project: string; global: string} {
  const projectRoot = resolveWorkspaceRoot({
    cwd: environment.cwd,
    projectRoot: environment.projectRoot,
  });
  const userHome = environment.userHome ?? homedir();

  return {
    project: path.join(projectRoot, MEMORY_FILE_NAME),
    global: path.join(userHome, '.codara', MEMORY_FILE_NAME),
  };
}

function formatMemoryScope(scope: 'project' | 'global', filePath: string): string {
  return `- ${scope}: ${filePath}${existsSync(filePath) ? '' : ' (missing)'}`;
}
