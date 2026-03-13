import path from 'node:path';
import {
  type ProgressiveInstructionSource,
  type ProgressiveInstructionWorkspaceOptions,
  SessionScopedProgressiveInstructionSource,
} from '@core/context/instructions/progressive-source';

const AGENTS_FILE_NAME = 'AGENTS.md';

export type GuidelinesOptions = ProgressiveInstructionWorkspaceOptions;
export type GuidelinesSource = ProgressiveInstructionSource;

export function createCodaraGuidelinesSource(options: GuidelinesOptions = {}): GuidelinesSource {
  return new SessionScopedProgressiveInstructionSource({
    ...options,
    title: '# AGENTS Guidelines',
    lead: 'Loaded from the workspace guideline stack. Read the files directly if more detail is required.',
    globalFileName: AGENTS_FILE_NAME,
    projectFileResolver(directory) {
      return path.join(directory, AGENTS_FILE_NAME);
    },
    blockTitle() {
      return AGENTS_FILE_NAME;
    },
  });
}
