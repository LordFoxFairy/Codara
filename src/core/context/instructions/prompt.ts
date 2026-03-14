import path from 'node:path';
import {resolveWorkspaceRoot} from '@core/config/workspace';
import {
  type ProgressiveInstructionSource,
  type ProgressiveInstructionWorkspaceOptions,
  SessionScopedProgressiveInstructionSource,
} from '@core/context/instructions/progressive-source';

const HANDBOOK_FILE_NAME = 'codara.md';

export type PromptOptions = ProgressiveInstructionWorkspaceOptions;
export type PromptSource = ProgressiveInstructionSource;

export function createCodaraPromptSource(options: PromptOptions = {}): PromptSource {
  const projectRoot = resolveWorkspaceRoot(options);
  return new SessionScopedProgressiveInstructionSource({
    ...options,
    cwd: projectRoot,
    projectRoot,
    title: '# Codara Handbook',
    lead: 'Loaded from the Codara handbook stack. Treat this as the core product manual for this workspace.',
    globalFileName: HANDBOOK_FILE_NAME,
    projectFileResolver(directory) {
      return path.join(directory, '.codara', HANDBOOK_FILE_NAME);
    },
    blockTitle() {
      return HANDBOOK_FILE_NAME;
    },
  });
}
