/**
 * Concrete instruction sources — configures the progressive instruction engine
 * for specific file types (AGENTS.md, codara.md).
 *
 * Each factory creates a SessionScopedProgressiveInstructionSource wired to
 * the correct file names and directory conventions. The heavy lifting
 * (file loading, caching, import expansion) lives in instructions.ts.
 *
 * Consumed by: system-message.ts, session-bootstrap.ts, init-context.ts.
 */
import path from 'node:path';
import {homedir} from 'node:os';
import {resolveWorkspaceRoot} from '@config/workspace';
import {createWorkspaceKey} from '@config/workspace';
import {
  type ProgressiveInstructionSource,
  type ProgressiveInstructionWorkspaceOptions,
  SessionScopedProgressiveInstructionSource,
} from '@context/instructions';

// ── AGENTS.md (agent guidelines) ─────────────────────────────────────

const AGENTS_FILE_NAME = 'AGENTS.md';

/** A ProgressiveInstructionSource that loads AGENTS.md files. */
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

// ── codara.md (product handbook) ─────────────────────────────────────

const HANDBOOK_FILE_NAME = 'codara.md';

/** A ProgressiveInstructionSource that loads codara.md files. */
export type PromptSource = ProgressiveInstructionSource;

export function createCodaraPromptSource(options: ProgressiveInstructionWorkspaceOptions = {}): PromptSource {
  const projectRoot = resolveWorkspaceRoot(options);
  const userHome = path.resolve(options.userHome ?? homedir());
  const workspaceKey = createWorkspaceKey(projectRoot);

  return new SessionScopedProgressiveInstructionSource({
    ...options,
    cwd: projectRoot,
    projectRoot,
    title: '# Codara Handbook',
    lead: 'Loaded from the Codara handbook stack. Treat this as the core product manual for this workspace.',
    globalFileName: HANDBOOK_FILE_NAME,
    userProjectFiles: [
      path.join(userHome, '.codara', 'projects', workspaceKey, HANDBOOK_FILE_NAME),
    ],
    projectFileResolver(directory) {
      return path.join(directory, '.codara', HANDBOOK_FILE_NAME);
    },
    blockTitle() {
      return HANDBOOK_FILE_NAME;
    },
  });
}
