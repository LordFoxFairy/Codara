import {mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import type {MemoryOptions} from '@core/memory/types';

export type MemoryScope = 'global' | 'project';

export interface MemoryStore {
  resolve(scope: MemoryScope): string;
  exists(scope: MemoryScope): Promise<boolean>;
  read(scope: MemoryScope): Promise<string | undefined>;
  write(scope: MemoryScope, content: string): Promise<void>;
  delete(scope: MemoryScope): Promise<void>;
}

/** 创建最小 MEMORY.md 读写接口。 */
export function createMemoryStore(options: MemoryOptions = {}): MemoryStore {
  const userHome = options.userHome ?? homedir();
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());

  function resolve(scope: MemoryScope): string {
    if (scope === 'global') {
      return path.join(userHome, '.codara', 'MEMORY.md');
    }

    return path.join(projectRoot, 'MEMORY.md');
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

    async read(scope) {
      const filePath = resolve(scope);
      try {
        return await readFile(filePath, 'utf8');
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
