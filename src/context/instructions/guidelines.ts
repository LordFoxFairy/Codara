import path from 'node:path';
import {homedir} from 'node:os';
import {resolveWorkspaceRoot} from '@config/workspace';
import {createWorkspaceKey} from '@config/workspace-key';
import {
  type ProgressiveInstructionSource,
  type ProgressiveInstructionWorkspaceOptions,
  SessionScopedProgressiveInstructionSource,
} from '@context/instructions/progressive-source';

const AGENTS_FILE_NAME = 'AGENTS.md';

export type GuidelinesSource = ProgressiveInstructionSource;

export function createCodaraGuidelinesSource(options: ProgressiveInstructionWorkspaceOptions = {}): GuidelinesSource {
  const projectRoot = resolveWorkspaceRoot(options);
  const userHome = path.resolve(options.userHome ?? homedir());
  const workspaceKey = createWorkspaceKey(projectRoot);

  return new SessionScopedProgressiveInstructionSource({
    ...options,
    title: '# AGENTS Guidelines',
    lead: 'Loaded from the workspace guideline stack. Read the files directly if more detail is required.',
    globalFileName: AGENTS_FILE_NAME,
    userProjectFiles: [
      path.join(userHome, '.codara', 'projects', workspaceKey, AGENTS_FILE_NAME),
    ],
    projectFileResolver(directory) {
      return path.join(directory, AGENTS_FILE_NAME);
    },
    blockTitle() {
      return AGENTS_FILE_NAME;
    },
  });
}
