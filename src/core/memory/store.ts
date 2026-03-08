import {mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import type {MemoryScope, MemorySourceOptions} from '@core/memory/types';
import {resolveWorkspaceRoot} from '@core/workspace';

const MAX_MEMORY_FILE_SIZE = 5 * 1024 * 1024; // 5MB - memory files should be concise

export interface MemoryReadOptions {
  /** 最大行数限制，默认 200（对齐 Claude Code） */
  maxLines?: number;
  /** 截断提示消息 */
  truncateMessage?: string;
}

export interface MemoryStore {
  resolve(scope: MemoryScope): string;
  exists(scope: MemoryScope): Promise<boolean>;
  read(scope: MemoryScope, options?: MemoryReadOptions): Promise<string | undefined>;
  write(scope: MemoryScope, content: string): Promise<void>;
  delete(scope: MemoryScope): Promise<void>;
}

/** 创建最小 MEMORY.md 读写接口。 */
export function createMemoryStore(options: MemorySourceOptions = {}): MemoryStore {
  const userHome = options.userHome ?? homedir();
  const projectRoot = resolveWorkspaceRoot(options);

  function resolve(scope: MemoryScope): string {
    if (scope === 'global') {
      return path.join(userHome, '.codara', 'MEMORY.md');
    }

    // 项目 Memory 放在 .codara/ 子目录下
    return path.join(projectRoot, '.codara', 'MEMORY.md');
  }

  return {
    resolve,

    async exists(scope) {
      try {
        await stat(resolve(scope));
        return true;
      } catch {
        return false;
      }
    },

    async read(scope, readOptions) {
      const filePath = resolve(scope);
      try {
        // Check file size before loading
        const stats = await stat(filePath);
        if (stats.size > MAX_MEMORY_FILE_SIZE) {
          console.warn(
            `[Memory] File ${filePath} size ${(stats.size / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_MEMORY_FILE_SIZE / 1024 / 1024}MB limit, skipping`
          );
          return undefined;
        }

        const content = await readFile(filePath, 'utf8');

        // 对齐 Claude Code: 默认截断到 200 行
        const maxLines = readOptions?.maxLines ?? 200;
        const lines = content.split('\n');

        if (lines.length > maxLines) {
          const truncated = lines.slice(0, maxLines).join('\n');
          const truncatedCount = lines.length - maxLines;
          const message = readOptions?.truncateMessage
            ?? `\n\n[... ${truncatedCount} lines truncated. MEMORY.md is limited to ${maxLines} lines to keep context concise.]`;

          return truncated + message;
        }

        return content;
      } catch {
        return undefined;
      }
    },

    async write(scope, content) {
      const filePath = resolve(scope);
      await mkdir(path.dirname(filePath), {recursive: true});
      await writeFile(filePath, content, 'utf8');
    },

    async delete(scope) {
      await rm(resolve(scope), {force: true});
    },
  };
}
