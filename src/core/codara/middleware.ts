import {createHILMiddleware, createLoggingMiddleware, type BaseMiddleware} from '@core/middleware';
import {createSkillsMiddleware, FileSystemSkillStore} from '@core/middleware/skills';
import {createAgentsGuidelinesMiddleware} from '@core/guidelines';
import {createMemoryMiddleware} from '@core/memory';
import type {CreateCodaraMiddlewareOptions} from '@core/codara/types';

/** 构建 Codara 默认中间件链。 */
export function createCodaraMiddlewares(options: CreateCodaraMiddlewareOptions = {}): BaseMiddleware[] {
  const middlewares: BaseMiddleware[] = [];

  if (options.logging && options.logging.enabled !== false) {
    middlewares.push(createLoggingMiddleware(options.logging));
  }

  if (options.agentsGuidelines !== false) {
    middlewares.push(createAgentsGuidelinesMiddleware(resolveAgentsGuidelinesOptions(options)));
  }

  if (options.memory !== false) {
    middlewares.push(createMemoryMiddleware(resolveMemoryOptions(options)));
  }

  if (options.skills !== false) {
    middlewares.push(createSkillsMiddleware(resolveSkillsOptions(options.skills)));
  }

  middlewares.push(...(options.middleware ?? options.middlewares ?? []));

  if (options.hil !== false) {
    middlewares.push(createHILMiddleware(options.hil ?? {}));
  }

  return middlewares;
}

function resolveAgentsGuidelinesOptions(options: CreateCodaraMiddlewareOptions) {
  if (options.agentsGuidelines === false) {
    return {};
  }

  return {
    ...(options.agentsGuidelines?.userHome ? {userHome: options.agentsGuidelines.userHome} : {}),
    ...(options.agentsGuidelines?.projectRoot ? {projectRoot: options.agentsGuidelines.projectRoot} : {}),
  };
}

function resolveMemoryOptions(options: CreateCodaraMiddlewareOptions) {
  if (options.memory === false) {
    return {};
  }

  return {
    ...(options.memory?.userHome ? {userHome: options.memory.userHome} : {}),
    ...(options.memory?.projectRoot ? {projectRoot: options.memory.projectRoot} : {}),
    ...(typeof options.memory?.maxChars === 'number' ? {maxChars: options.memory.maxChars} : {}),
  };
}

function resolveSkillsOptions(options: CreateCodaraMiddlewareOptions['skills']) {
  if (options === false) {
    return {store: new FileSystemSkillStore({sources: []})};
  }

  if (options?.store) {
    return {store: options.store};
  }

  return {
    store: new FileSystemSkillStore({
      ...(options?.sources ? {sources: options.sources} : {}),
      ...(options?.projectRoot ? {projectRoot: options.projectRoot} : {}),
      ...(options?.userHome ? {userHome: options.userHome} : {}),
      ...(typeof options?.cacheTtlMs === 'number' ? {cacheTtlMs: options.cacheTtlMs} : {}),
    }),
  };
}
