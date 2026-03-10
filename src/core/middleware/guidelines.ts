import {homedir} from 'node:os';
import {createMiddleware} from '@core/middleware';
import type {AgentsSource} from '@core/sessions/agents-source';
import type {WorkspaceFileOptions, WorkspaceScopedFile} from '@core/workspace';
import {discoverHierarchicalWorkspaceFiles, loadInstructionFiles} from '@core/workspace';

const DEFAULT_LINES = 500;

export type GuidelineFile = WorkspaceScopedFile;

export interface LoadedGuidelines {
  files: GuidelineFile[];
  content: string;
}

export interface GuidelinesOptions extends WorkspaceFileOptions {
  maxLines?: number;
}

/**
 * 加载 AGENTS.md 内容投影。
 *
 * 该投影在 AGENTS source reload 时重新计算一次。
 * 如需完整内容，应通过现有文件工具按路径读取原文件。
 */
export async function loadGuidelines(options: GuidelinesOptions = {}): Promise<LoadedGuidelines | undefined> {
  const maxLines = options.maxLines ?? DEFAULT_LINES;
  const userHome = options.userHome ?? homedir();
  const loadedFiles = await loadInstructionFiles(
    discoverHierarchicalWorkspaceFiles('AGENTS.md', {
      cwd: options.cwd,
      projectRoot: options.projectRoot,
      userHome,
    }),
    {maxLines},
  );

  if (loadedFiles.length === 0) {
    return undefined;
  }

  return {
    files: loadedFiles.map(({scope, path}) => ({scope, path})),
    content: [
      '# AGENTS Guidelines',
      '',
      'Loaded from the configured source stack. Read the source files directly if more detail is required.',
      '',
      ...loadedFiles.flatMap((file, index) => {
        const label = file.scope === 'global' ? 'Global AGENTS.md' : 'Project AGENTS.md';
        const lines = [`## ${label}`, `Path: ${file.path}`];

        if (file.content.length > 0) {
          lines.push('', ...file.content.split('\n'));
        }
        if (file.truncated) {
          lines.push('', `Truncated after ${maxLines} lines. Read the file directly for full content.`);
        }

        return index === 0 ? lines : ['', ...lines];
      }),
    ].join('\n'),
  };
}

/** 注入由 AGENTS source 提供的 AGENTS.md 投影。 */
export function createGuidelinesMiddleware(agentsSource?: AgentsSource) {
  return createMiddleware({
    name: 'GuidelinesMiddleware',
    async beforeModel(context) {
      if (!agentsSource) {
        return undefined;
      }

      const content = await agentsSource.getContent();
      if (!content) {
        return undefined;
      }

      context.systemMessage.push(content);
      return undefined;
    },
  });
}
