import {createHILMiddleware, createLoggingMiddleware, type BaseMiddleware} from '@core/middleware';
import {createGuidelinesMiddleware} from '@core/middleware/guidelines';
import {createContextBudgetMiddleware} from '@core/middleware/context-budget';
import {createMemoryMiddleware} from '@core/middleware/memory';
import {createSummaryMiddleware} from '@core/middleware/summary';
import type {CodaraMiddlewareOptions} from '@core/codara/types';
import {createSkillsMiddleware, FileSystemSkillStore} from '@core/skills';
import {resolveWorkspaceRoot} from '@core/workspace';
import type {SourceProvider} from '@core/sessions/source-provider';

/**
 * 构建 Codara 默认中间件链。
 *
 * 中间件顺序（有依赖关系，不可随意调整）：
 * 1. logging - 观测所有阶段
 * 2. guidelines - 注入 AGENTS.md
 * 3. memory - 注入 MEMORY.md
 * 4. skills - 注入 skills 描述
 * 5. context-budget - 估算 token（必须在所有 systemMessage 注入之后）
 * 6. summary - 压缩历史（依赖 context-budget 的估算结果）
 * 7. caller middlewares - 用户自定义
 * 8. hil - 暂停/恢复（必须在最后，拦截 tool 执行）
 */
export function createCodaraMiddlewares(
  options: CodaraMiddlewareOptions = {},
  sourceProvider?: SourceProvider
): BaseMiddleware[] {
  const middlewares: BaseMiddleware[] = [];

  // 1. Logging（可选）
  if (options.logging && options.logging.enabled !== false) {
    middlewares.push(createLoggingMiddleware(options.logging));
  }

  // 2. Guidelines（默认启用）
  if (options.guidelines !== false) {
    middlewares.push(createGuidelinesMiddleware(sourceProvider));
  }

  // 3. Memory（默认启用）
  if (options.memory !== false) {
    middlewares.push(createMemoryMiddleware(sourceProvider));
  }

  // 4. Skills（默认启用）
  if (options.skills !== false) {
    middlewares.push(createSkillsMiddleware(resolveSkillsOptions(options)));
  }

  // 5. Context Budget（必须在 systemMessage 注入之后）
  middlewares.push(createContextBudgetMiddleware());

  // 6. Summary（可选，依赖 context-budget）
  if (options.summary) {
    middlewares.push(createSummaryMiddleware(options.summary));
  }

  // 7. Caller middlewares
  middlewares.push(...(options.middleware ?? options.middlewares ?? []));

  // 8. HIL（默认启用，必须在最后）
  if (options.hil !== false) {
    middlewares.push(createHILMiddleware(options.hil ?? {}));
  }

  return middlewares;
}

function resolveSkillsOptions(options: CodaraMiddlewareOptions) {
  if (options.skills === false) {
    return {store: new FileSystemSkillStore({sources: []}), agentRoots: []};
  }

  if (options.skills?.store) {
    return {
      store: options.skills.store,
      ...(options.skills.agentRoots ? {agentRoots: options.skills.agentRoots} : {}),
    };
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
    ...(options.skills?.agentRoots ? {agentRoots: options.skills.agentRoots} : {}),
  };
}
