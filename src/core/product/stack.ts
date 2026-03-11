import {createHILMiddleware, createLoggingMiddleware, type BaseMiddleware} from '@core/middleware';
import {createConversationContextMiddleware} from '@core/middleware/conversation';
import type {CodaraMiddlewareOptions, CodaraSkillOptions} from '@core/product/types';
import {FileSystemSkillStore, type SkillStore} from '@core/skills';
import {resolveWorkspaceRoot} from '@core/support/workspace';

export interface CodaraResolvedSkills {
  store: SkillStore;
  subagentRoots: string[];
}

/**
 * 构建 Codara 默认中间件链。
 *
 * 中间件顺序（有依赖关系，不可随意调整）：
 * 1. logging - 观测所有阶段
 * 2. caller middlewares - 用户自定义运行时拦截
 * 3. conversation-context - 统一预算估算与历史压缩
 * 4. hil - 暂停/恢复（必须在最后，拦截 tool 执行）
 *
 * Source-driven system layers（guidelines / skills）不再由默认 middleware 注入，
 * 而是在 session preload 后，由 agent 的 turn preparation 统一组装到 model input。
 */
export function createCodaraMiddlewares(
  options: CodaraMiddlewareOptions = {},
): BaseMiddleware[] {
  const middlewares: BaseMiddleware[] = [];

  // 1. Logging（可选）
  if (options.logging && options.logging.enabled !== false) {
    middlewares.push(createLoggingMiddleware(options.logging));
  }

  // 2. Caller middlewares（让追加的 systemMessage 也能进入 budget / summary）
  middlewares.push(...(options.middleware ?? []));

  // 3. Conversation Context（统一 budget + summary）
  middlewares.push(createConversationContextMiddleware({
    summary: options.summary,
  }));

  // 4. HIL（默认启用，必须在最后）
  if (options.hil !== false) {
    middlewares.push(createHILMiddleware(options.hil ?? {}));
  }

  return middlewares;
}

export function resolveCodaraSkills(
  options: Pick<CodaraMiddlewareOptions, 'skills' | 'cwd'>,
): CodaraResolvedSkills | undefined {
  if (options.skills === false) {
    return undefined;
  }

  if (options.skills?.store) {
    return {
      store: options.skills.store,
      subagentRoots: options.skills.subagentRoots ?? [],
    };
  }

  return {
    store: new FileSystemSkillStore(buildSkillStoreOptions(options.skills, options.cwd)),
    subagentRoots: options.skills?.subagentRoots ?? [],
  };
}

function buildSkillStoreOptions(skills: CodaraSkillOptions | undefined, cwd: string | undefined) {
  const skillOptions = skills;
  return {
    ...(skillOptions?.sources ? {sources: skillOptions.sources} : {}),
    ...((skillOptions?.projectRoot || skillOptions?.cwd || cwd)
      ? {
          projectRoot: resolveWorkspaceRoot({
            projectRoot: skillOptions?.projectRoot,
            cwd: skillOptions?.cwd ?? cwd,
          }),
        }
      : {}),
    ...((skillOptions?.cwd || cwd) ? {cwd: skillOptions?.cwd ?? cwd} : {}),
    ...(skillOptions?.userHome ? {userHome: skillOptions.userHome} : {}),
    ...(typeof skillOptions?.cacheTtlMs === 'number' ? {cacheTtlMs: skillOptions.cacheTtlMs} : {}),
  };
}
