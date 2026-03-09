import {loadGuidelines} from '@core/middleware/guidelines';
import {loadMemory} from '@core/middleware/memory';
import type {CodaraAgentOptions} from '@core/codara/types';

export interface CodaraSourceProjection {
  guidelines?: string;
  memory?: string;
}

export async function loadCodaraSourceProjection(options: CodaraAgentOptions): Promise<CodaraSourceProjection> {
  const [guidelines, memory] = await Promise.all([
    options.guidelines === false ? Promise.resolve(undefined) : loadGuidelines(resolveGuidelinesOptions(options)),
    options.memory === false ? Promise.resolve(undefined) : loadMemory(resolveMemoryOptions(options)),
  ]);

  return {
    guidelines: guidelines?.content,
    memory: memory?.content,
  };
}

function resolveGuidelinesOptions(options: CodaraAgentOptions) {
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

function resolveMemoryOptions(options: CodaraAgentOptions) {
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
