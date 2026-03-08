import {createHILMiddleware, createLoggingMiddleware, type BaseMiddleware} from '@core/middleware';
import {createSkillsMiddleware, FileSystemSkillStore} from '@core/middleware/skills';
import {createGuidelinesMiddleware, loadGuidelines, type GuidelinesOptions} from '@core/middleware/guidelines';
import {createMemoryMiddleware, loadMemory} from '@core/middleware/memory';
import {createSummaryMiddleware} from '@core/middleware/summary';
import type {CodaraMiddlewareOptions} from '@core/codara/types';
import {resolveWorkspaceRoot} from '@core/workspace';

export interface CodaraLoadedSources {
  guidelines?: string;
  memory?: string;
}

/** 构建 Codara 默认中间件链。 */
export function createCodaraMiddlewares(
  options: CodaraMiddlewareOptions = {},
  loadedSources: CodaraLoadedSources = {}
): BaseMiddleware[] {
  const middlewares: BaseMiddleware[] = [];

  if (options.logging && options.logging.enabled !== false) {
    middlewares.push(createLoggingMiddleware(options.logging));
  }

  if (options.guidelines !== false) {
    middlewares.push(createGuidelinesMiddleware(loadedSources.guidelines));
  }

  if (options.memory !== false) {
    middlewares.push(createMemoryMiddleware(loadedSources.memory));
  }

  if (options.summary) {
    middlewares.push(createSummaryMiddleware(options.summary));
  }

  if (options.skills !== false) {
    middlewares.push(createSkillsMiddleware(resolveSkillsOptions(options)));
  }

  middlewares.push(...(options.middleware ?? options.middlewares ?? []));

  if (options.hil !== false) {
    middlewares.push(createHILMiddleware(options.hil ?? {}));
  }

  return middlewares;
}

/** 在 agent 初始化阶段加载 guidelines 与 memory 摘要。 */
export async function loadCodaraSources(options: CodaraMiddlewareOptions = {}): Promise<CodaraLoadedSources> {
  const [guidelines, memory] = await Promise.all([
    options.guidelines === false ? Promise.resolve(undefined) : loadGuidelines(resolveGuidelinesOptions(options)),
    options.memory === false ? Promise.resolve(undefined) : loadMemory(resolveMemoryOptions(options)),
  ]);

  return {
    guidelines: guidelines?.content,
    memory: memory?.content,
  };
}

function resolveSkillsOptions(options: CodaraMiddlewareOptions) {
  if (options.skills === false) {
    return {store: new FileSystemSkillStore({sources: []})};
  }

  if (options.skills?.store) {
    return {store: options.skills.store};
  }

  return {
    store: new FileSystemSkillStore({
      ...(options.skills?.sources ? {sources: options.skills.sources} : {}),
      ...((options.skills?.projectRoot || options.skills?.cwd || options.cwd)
        ? {
            projectRoot: resolveWorkspaceRoot({
              projectRoot: options.skills?.projectRoot,
              cwd: options.skills?.cwd ?? options.cwd,
            }),
          }
        : {}),
      ...((options.skills?.cwd || options.cwd) ? {cwd: options.skills?.cwd ?? options.cwd} : {}),
      ...(options.skills?.userHome ? {userHome: options.skills.userHome} : {}),
      ...(typeof options.skills?.cacheTtlMs === 'number' ? {cacheTtlMs: options.skills.cacheTtlMs} : {}),
    }),
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

function resolveMemoryOptions(options: CodaraMiddlewareOptions) {
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
