import {createHILMiddleware, createLoggingMiddleware, type BaseMiddleware} from '@core/middleware';
import {createSkillsMiddleware, FileSystemSkillStore} from '@core/middleware/skills';
import {createGuidelinesMiddleware} from '@core/guidelines';
import {createMemoryMiddleware} from '@core/memory';
import {createSummaryMiddleware} from '@core/summary';
import type {CreateCodaraMiddlewareOptions} from '@core/codara/types';
import {resolveWorkspaceRoot} from '@core/workspace';

/** 构建 Codara 默认中间件链。 */
export function createCodaraMiddlewares(options: CreateCodaraMiddlewareOptions = {}): BaseMiddleware[] {
  const middlewares: BaseMiddleware[] = [];

  if (options.logging && options.logging.enabled !== false) {
    middlewares.push(createLoggingMiddleware(options.logging));
  }

  if (options.guidelines !== false) {
    middlewares.push(createGuidelinesMiddleware(resolveGuidelinesOptions(options)));
  }

  if (options.memory !== false) {
    middlewares.push(createMemoryMiddleware(resolveMemoryOptions(options)));
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

function resolveGuidelinesOptions(options: CreateCodaraMiddlewareOptions) {
  if (options.guidelines === false) {
    return {};
  }

  return {
    ...(options.guidelines?.cwd ?? options.cwd ? {cwd: options.guidelines?.cwd ?? options.cwd} : {}),
    ...(options.guidelines?.userHome ? {userHome: options.guidelines.userHome} : {}),
    ...(options.guidelines?.projectRoot ? {projectRoot: options.guidelines.projectRoot} : {}),
  };
}

function resolveMemoryOptions(options: CreateCodaraMiddlewareOptions) {
  if (options.memory === false) {
    return {};
  }

  return {
    ...(options.memory?.cwd ?? options.cwd ? {cwd: options.memory?.cwd ?? options.cwd} : {}),
    ...(options.memory?.userHome ? {userHome: options.memory.userHome} : {}),
    ...(options.memory?.projectRoot ? {projectRoot: options.memory.projectRoot} : {}),
    ...(typeof options.memory?.maxChars === 'number' ? {maxChars: options.memory.maxChars} : {}),
  };
}

function resolveSkillsOptions(options: CreateCodaraMiddlewareOptions) {
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
