import {createMiddleware} from '@core/middleware';
import type {WorkspaceFileOptions, WorkspaceScopedFile} from '@core/workspace';
import {discoverWorkspaceFiles, loadWorkspaceFiles} from '@core/workspace';

const DEFAULT_LINES = 200;

export type MemoryFile = WorkspaceScopedFile;

/** MEMORY.md 的加载结果。 */
export interface LoadedMemory {
  files: MemoryFile[];
  content: string;
}

/** MEMORY.md 定位与加载选项。 */
export interface MemoryOptions extends WorkspaceFileOptions {
  /** 每个文件默认保留的原始行数。 */
  maxLines?: number;
}

/**
 * 加载 MEMORY.md 内容投影。
 *
 * 该投影在 agent 或 session 初始化阶段生成一次。
 * 如需完整内容，应通过现有文件工具按路径读取原文件。
 */
export async function loadMemory(options: MemoryOptions = {}): Promise<LoadedMemory | undefined> {
  const maxLines = options.maxLines ?? DEFAULT_LINES;
  const loadedFiles = await loadWorkspaceFiles(discoverWorkspaceFiles('MEMORY.md', options, '.codara'), {maxLines});

  if (loadedFiles.length === 0) {
    return undefined;
  }

  return {
    files: loadedFiles.map(({scope, path}) => ({scope, path})),
    content: [
      '# Project Memory',
      '',
      'Loaded at session start. Read the source files directly if more detail is required.',
      '',
      ...loadedFiles.flatMap((file, index) => {
        const label = file.scope === 'global' ? 'Global MEMORY.md' : 'Project MEMORY.md';
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

/** 注入预加载的 MEMORY.md 内容。 */
export function createMemoryMiddleware(content?: string) {
  return createMiddleware({
    name: 'MemoryMiddleware',
    async beforeModel(context) {
      if (!content) {
        return undefined;
      }

      context.systemMessage.push(content);
      return undefined;
    },
  });
}
