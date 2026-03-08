import {createMemoryEditor, createMemoryStore, type MemoryEditor, type MemorySourceOptions, type MemoryStore} from '@core/memory';
import type {CreateCodaraAgentOptions} from '@core/codara/types';

/** 创建绑定 Codara 工作区作用域的 memory store。 */
export function createCodaraMemoryStore(options: Pick<CreateCodaraAgentOptions, 'cwd' | 'memory'> = {}): MemoryStore {
  return createMemoryStore(resolveCodaraMemorySourceOptions(options));
}

/** 创建绑定 Codara 工作区作用域的 memory editor。 */
export function createCodaraMemoryEditor(options: Pick<CreateCodaraAgentOptions, 'cwd' | 'memory'> = {}): MemoryEditor {
  return createMemoryEditor(resolveCodaraMemorySourceOptions(options));
}

function resolveCodaraMemorySourceOptions(
  options: Pick<CreateCodaraAgentOptions, 'cwd' | 'memory'>
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
