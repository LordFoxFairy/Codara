import {
  createMemoryEditor,
  createMemoryStore,
  type MemoryEditor,
  type MemorySourceOptions,
  type MemoryStore,
} from '@core/memory';
import type {CreateCodaraAgentOptions} from '@core/codara/types';

export interface CodaraMemory extends MemoryStore, MemoryEditor {}

/** 创建绑定 Codara 工作区作用域的 memory store。 */
export function createCodaraMemoryStore(options: Pick<CreateCodaraAgentOptions, 'cwd' | 'memory'> = {}): MemoryStore {
  return createMemoryStore(resolveCodaraMemorySourceOptions(options));
}

/** 创建绑定 Codara 工作区作用域的 memory editor。 */
export function createCodaraMemoryEditor(options: Pick<CreateCodaraAgentOptions, 'cwd' | 'memory'> = {}): MemoryEditor {
  return createMemoryEditor(resolveCodaraMemorySourceOptions(options));
}

/** 创建绑定 Codara 工作区作用域的完整 memory 访问对象。 */
export function createCodaraMemory(options: Pick<CreateCodaraAgentOptions, 'cwd' | 'memory'> = {}): CodaraMemory {
  const sourceOptions = resolveCodaraMemorySourceOptions(options);
  const store = createMemoryStore(sourceOptions);
  const editor = createMemoryEditor(sourceOptions);

  return {
    resolve: store.resolve,
    exists: store.exists,
    read: store.read,
    write: store.write,
    delete: store.delete,
    snapshot: editor.snapshot,
    remember: editor.remember,
    forget: editor.forget,
  };
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
