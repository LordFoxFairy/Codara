import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {resolveWorkspaceRoot} from '@infra/config/workspace';
import {createWorkspaceKey} from '@infra/config/workspace-key';
import type {CodaraCommandDefinition} from '@capability/command/runtime/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;
const MEMORY_FILE_NAME = 'AGENTS.md';

export const memoryCommand: CodaraCommandDefinition = {
  name: 'memory',
  usage: '/memory [show|project|user|global]',
  description: 'Inspect or open the current AGENTS.md memory scopes for this runtime.',
  source: BUILTIN_SOURCE,
  help: {
    executionMode: 'host_action',
  },
  async execute({command, environment}) {
    const target = (command.args[0] ?? 'show').trim().toLowerCase();
    const files = resolveMemoryFiles(environment);

    if (target === 'show') {
      return {
        ok: true,
        command: command.name,
        output: [
          'Memory scopes:',
          formatMemoryScope('global', files.global),
          formatMemoryScope('user', files.user),
          formatMemoryScope('project', files.project),
          'Use /memory project, /memory user, or /memory global to open a file in the host shell.',
        ].join('\n'),
      };
    }

    if (target === 'project' || target === 'global' || target === 'user') {
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
      output: 'Usage: /memory [show|project|user|global]',
    };
  },
};

function resolveMemoryFiles(environment: {
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
}): {project: string; user: string; global: string} {
  const projectRoot = resolveWorkspaceRoot({
    cwd: environment.cwd,
    projectRoot: environment.projectRoot,
  });
  const userHome = environment.userHome ?? homedir();
  const workspaceKey = createWorkspaceKey(projectRoot);

  return {
    project: path.join(projectRoot, MEMORY_FILE_NAME),
    user: path.join(userHome, '.codara', 'projects', workspaceKey, MEMORY_FILE_NAME),
    global: path.join(userHome, '.codara', MEMORY_FILE_NAME),
  };
}

function formatMemoryScope(scope: string, filePath: string): string {
  return `- ${scope}: ${filePath}${existsSync(filePath) ? '' : ' (missing)'}`;
}
