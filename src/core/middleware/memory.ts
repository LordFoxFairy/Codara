import {createMiddleware} from '@core/middleware';
import type {SourceProvider} from '@core/sessions/source-provider';
import type {WorkspaceFileOptions, WorkspaceScopedFile} from '@core/workspace';
import {discoverWorkspaceFiles, loadWorkspaceFiles} from '@core/workspace';

const DEFAULT_LINES = 200;

export type MemoryFile = WorkspaceScopedFile;

export interface LoadedMemory {
  files: MemoryFile[];
  content: string;
}

export interface MemoryOptions extends WorkspaceFileOptions {
  maxLines?: number;
}

/**
 * 加载 MEMORY.md 内容投影。
 *
 * 该投影在 source provider 刷新时重新计算一次。
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
      'Loaded from the configured source stack. Read the source files directly if more detail is required.',
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

/** 注入由 source provider 提供的 MEMORY.md 投影。 */
export function createMemoryMiddleware(sourceProvider?: SourceProvider, key = 'memory') {
  return createMiddleware({
    name: 'MemoryMiddleware',
    async beforeModel(context) {
      if (!sourceProvider) {
        return undefined;
      }

      const content = await sourceProvider.get(key);
      if (!content) {
        return undefined;
      }

      context.systemMessage.push(content);
      return undefined;
    },
  });
}
