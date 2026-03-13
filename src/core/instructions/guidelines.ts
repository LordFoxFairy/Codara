import path from 'node:path';
import type {WorkspaceRootOptions} from '@core/config/workspace';
import {
  type InstructionPathTarget,
  SessionScopedProgressiveInstructionSource,
} from '@core/instructions/progressive-source';

const AGENTS_FILE_NAME = 'AGENTS.md';

export interface GuidelinesWorkspaceOptions extends WorkspaceRootOptions {
  userHome?: string;
}

export type GuidelinesOptions = GuidelinesWorkspaceOptions;

export interface GuidelinesSource {
  getContent(): Promise<string | undefined>;
  getBootstrapContent(): Promise<string | undefined>;
  getProgressiveContent(): Promise<string | undefined>;
  reload(): void;
  activateTarget(target: InstructionPathTarget): Promise<boolean>;
}

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
