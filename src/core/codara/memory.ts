import {
  createMemoryStore,
  type MemorySourceOptions,
  type MemoryStore,
} from '@core/memory';
import type {CodaraAgentOptions} from '@core/codara/types';

/**
 * CodaraMemory 就是 MemoryStore
 *
 * 对齐 Claude Code 设计：
 * - 只提供文件读写能力
 * - Agent 用 edit_file 直接编辑 MEMORY.md
 * - 不需要 remember/forget/snapshot 等高层 API
 */
export type CodaraMemory = MemoryStore;

/** 创建绑定 Codara 工作区作用域的 memory store。 */
export function createCodaraMemory(options: Pick<CodaraAgentOptions, 'cwd' | 'memory'> = {}): CodaraMemory {
  return createMemoryStore(resolveCodaraMemorySourceOptions(options));
}

function resolveCodaraMemorySourceOptions(
  options: Pick<CodaraAgentOptions, 'cwd' | 'memory'>
): MemorySourceOptions {
  if (options.memory === false) {
    return {
      ...(options.cwd ? {cwd: options.cwd} : {}),
    };
  }

  return {
    ...(options.memory?.cwd ?? options.cwd ? {cwd: options.memory?.cwd ?? options.cwd} : {}),
    ...(options.memory?.userHome ? {userHome: options.memory.userHome} : {}),
    ...(options.memory?.projectRoot ? {projectRoot: options.memory.projectRoot} : {}),
  };
}
