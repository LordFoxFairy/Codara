import {createHILMiddleware, createLoggingMiddleware, type BaseMiddleware} from '@core/middleware';
import {createGuidelinesMiddleware} from '@core/middleware/guidelines';
import {createConversationContextMiddleware} from '@core/middleware/conversation-context';
import type {CodaraMiddlewareOptions} from '@core/codara/types';
import {createSkillsMiddleware, FileSystemSkillStore} from '@core/skills';
import {resolveWorkspaceRoot} from '@core/workspace';
import type {AgentsSource} from '@core/sessions/agents-source';

/**
 * 构建 Codara 默认中间件链。
 *
 * 中间件顺序（有依赖关系，不可随意调整）：
 * 1. logging - 观测所有阶段
 * 2. guidelines - 注入 AGENTS.md
 * 3. skills - 注入 skills 描述
 * 4. caller middlewares - 用户自定义（让追加的 systemMessage 也能参与 budget / summary）
 * 5. conversation-context - 统一预算估算与历史压缩
 * 6. hil - 暂停/恢复（必须在最后，拦截 tool 执行）
 */
export function createCodaraMiddlewares(
  options: CodaraMiddlewareOptions = {},
  agentsSource?: AgentsSource
): BaseMiddleware[] {
  const middlewares: BaseMiddleware[] = [];

  // 1. Logging（可选）
  if (options.logging && options.logging.enabled !== false) {
    middlewares.push(createLoggingMiddleware(options.logging));
  }

  // 2. Guidelines（默认启用）
  if (options.guidelines !== false) {
    middlewares.push(createGuidelinesMiddleware(agentsSource));
  }

  // 3. Skills（默认启用）
  if (options.skills !== false) {
    middlewares.push(createSkillsMiddleware(resolveSkillsOptions(options)));
  }

  // 4. Caller middlewares（让追加的 systemMessage 也能进入 budget / summary）
  middlewares.push(...(options.middleware ?? options.middlewares ?? []));

  // 5. Conversation Context（统一 budget + summary）
  middlewares.push(createConversationContextMiddleware({
    summary: options.summary,
  }));

  // 6. HIL（默认启用，必须在最后）
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
