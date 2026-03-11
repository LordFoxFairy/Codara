import {createHILMiddleware, createLoggingMiddleware, type BaseMiddleware} from '@core/middleware';
import {createGuidelinesMiddleware} from '@core/middleware/guidelines';
import {createConversationContextMiddleware} from '@core/middleware/conversation-context';
import type {CodaraMiddlewareOptions, CodaraSkillOptions} from '@core/codara/types';
import {createSkillsMiddleware} from '@core/skills';
import type {AgentsSource} from '@core/sessions/agents';
import type {SkillsSource} from '@core/sessions/skills';
import {FileSystemSkillStore, type SkillStore} from '@core/skills';
import {resolveWorkspaceRoot} from '@core/workspace';

export interface CodaraResolvedSkills {
  store: SkillStore;
  agentRoots: string[];
}

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
  agentsSource?: AgentsSource,
  skillsSource?: SkillsSource,
  resolvedSkills = resolveCodaraSkills(options),
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
  if (resolvedSkills) {
    middlewares.push(skillsSource
      ? createSkillsMiddleware({source: skillsSource})
      : createSkillsMiddleware(resolvedSkills));
  }

  // 4. Caller middlewares（让追加的 systemMessage 也能进入 budget / summary）
  middlewares.push(...(options.middleware ?? []));

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

export function resolveCodaraSkills(
  options: Pick<CodaraMiddlewareOptions, 'skills' | 'cwd'>,
): CodaraResolvedSkills | undefined {
  if (options.skills === false) {
    return undefined;
  }

  if (options.skills?.store) {
    return {
      store: options.skills.store,
      agentRoots: options.skills.agentRoots ?? [],
    };
  }

  return {
    store: new FileSystemSkillStore(buildSkillStoreOptions(options.skills, options.cwd)),
    agentRoots: options.skills?.agentRoots ?? [],
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
