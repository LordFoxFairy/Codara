import {homedir} from 'node:os';
import path from 'node:path';
import {createMiddleware} from '@core/middleware';
import type {WorkspaceFileOptions, WorkspaceScopedFile} from '@core/workspace';
import {loadWorkspaceFiles, resolveWorkspaceRoot} from '@core/workspace';

const DEFAULT_LINES = 500;

export type GuidelineFile = WorkspaceScopedFile;

/** AGENTS.md 的加载结果。 */
export interface LoadedGuidelines {
  files: GuidelineFile[];
  content: string;
}

/** AGENTS.md 定位与加载选项。 */
export interface GuidelinesOptions extends WorkspaceFileOptions {
  /** 每个文件默认保留的原始行数。 */
  maxLines?: number;
}

/**
 * 加载 AGENTS.md 内容投影。
 *
 * 该投影在 agent 或 session 初始化阶段生成一次。
 * 如需完整内容，应通过现有文件工具按路径读取原文件。
 */
export async function loadGuidelines(options: GuidelinesOptions = {}): Promise<LoadedGuidelines | undefined> {
  const maxLines = options.maxLines ?? DEFAULT_LINES;
  const userHome = options.userHome ?? homedir();
  const projectRoot = resolveWorkspaceRoot({
    projectRoot: options.projectRoot,
    cwd: options.cwd,
  });
  const loadedFiles = await loadWorkspaceFiles(
    [
      {scope: 'global', path: path.join(userHome, '.codara', 'AGENTS.md')},
      {scope: 'project', path: path.join(projectRoot, 'AGENTS.md')},
    ],
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
      'Loaded at session start. Read the source files directly if more detail is required.',
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

/** 注入预加载的 AGENTS.md 内容。 */
export function createGuidelinesMiddleware(content?: string) {
  return createMiddleware({
    name: 'GuidelinesMiddleware',
    async wrapModelCall(context, handler) {
      if (!content) {
        return handler(context);
      }

      return handler({
        ...context,
        systemMessage: context.systemMessage.concat(content),
      });
    },
  });
}
