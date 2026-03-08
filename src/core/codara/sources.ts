import type {CodaraMiddlewareOptions} from '@core/codara/types';
import {loadGuidelines, type GuidelinesOptions} from '@core/middleware/guidelines';
import {loadMemory, type MemoryOptions} from '@core/middleware/memory';

export interface CodaraSourceStack {
  guidelines?: string;
  memory?: string;
}

/** 加载当前 session 需要的 source stack。 */
export async function loadCodaraSourceStack(
  options: CodaraMiddlewareOptions = {}
): Promise<CodaraSourceStack> {
  const [guidelines, memory] = await Promise.all([
    options.guidelines === false ? Promise.resolve(undefined) : loadGuidelines(resolveGuidelinesOptions(options)),
    options.memory === false ? Promise.resolve(undefined) : loadMemory(resolveMemoryOptions(options)),
  ]);

  return {
    guidelines: guidelines?.content,
    memory: memory?.content,
  };
}

function resolveGuidelinesOptions(options: CodaraMiddlewareOptions): GuidelinesOptions {
  if (options.guidelines === false) {
    return {
      ...(options.cwd ? {cwd: options.cwd} : {}),
    };
  }

  return {
    ...(options.guidelines?.cwd ?? options.cwd ? {cwd: options.guidelines?.cwd ?? options.cwd} : {}),
    ...(options.guidelines?.userHome ? {userHome: options.guidelines.userHome} : {}),
    ...(options.guidelines?.projectRoot ? {projectRoot: options.guidelines.projectRoot} : {}),
  };
}

function resolveMemoryOptions(options: CodaraMiddlewareOptions): MemoryOptions {
  if (options.memory === false) {
    return {
      ...(options.cwd ? {cwd: options.cwd} : {}),
    };
  }

  return {
    ...(options.memory?.cwd ?? options.cwd ? {cwd: options.memory?.cwd ?? options.cwd} : {}),
    ...(options.memory?.userHome ? {userHome: options.memory.userHome} : {}),
    ...(options.memory?.projectRoot ? {projectRoot: options.memory.projectRoot} : {}),
    ...(typeof options.memory?.maxLines === 'number' ? {maxLines: options.memory.maxLines} : {}),
  };
}
