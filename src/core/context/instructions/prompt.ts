import path from 'node:path';
import type {WorkspaceRootOptions} from '@core/config/workspace';
import {
  type InstructionPathTarget,
  SessionScopedProgressiveInstructionSource,
} from '@core/context/instructions/progressive-source';

const HANDBOOK_FILE_NAME = 'codara.md';

export interface PromptWorkspaceOptions extends WorkspaceRootOptions {
  userHome?: string;
}

export type PromptOptions = PromptWorkspaceOptions;

export interface PromptSource {
  getContent(): Promise<string | undefined>;
  getBootstrapContent(): Promise<string | undefined>;
  getProgressiveContent(): Promise<string | undefined>;
  reload(): void;
  activateTarget(target: InstructionPathTarget): Promise<boolean>;
}

export function createCodaraPromptSource(options: PromptOptions = {}): PromptSource {
  return new SessionScopedProgressiveInstructionSource({
    ...options,
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
