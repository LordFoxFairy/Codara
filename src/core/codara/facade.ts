import {createSession} from '@core/sessions';
import {createCodaraCommandRunner} from '@core/commands';
import type {Codara, CodaraOptions} from '@core/codara/types';
import type {Session, SessionState, SessionStore} from '@core/sessions';
import type {CodaraCommandHost} from '@core/commands';
import {createSkillCodaraCommands} from '@core/commands/skills';
import {
  createCodaraGuidelinesSource,
} from '@core/instructions/guidelines';
import {createCodaraModelCatalog, DEFAULT_CODARA_MODEL_ALIAS} from '@core/codara/models';
import {createHILMiddleware, createLoggingMiddleware, type BaseMiddleware} from '@core/middleware';
import {createConversationContextMiddleware} from '@core/middleware/conversation';
import {
  createCodaraSkillsSource,
  FileSystemSkillStore,
  type SkillStore,
} from '@core/instructions/skills';
import {resolveWorkspaceRoot} from '@core/support/workspace';
import {createBuiltinTools} from '@core/tools';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {CodaraMiddlewareOptions, CodaraSkillOptions, CodaraToolsOptions} from '@core/codara/types';

interface CodaraResolvedSkills {
  store: SkillStore;
  subagentRoots: string[];
}

/**
 * 创建 Codara 实例。
 *
 * 对外 API 设计对齐 Claude Code：
 * - 使用 alias（'default' / 'sonnet' / 'fast'）而不是暴露 provider:model
 * - 简洁、产品化、不暴露内部实现细节
 *
 * @example
 * ```ts
 * // 使用默认 model
 * const codara = createCodara();
 *
 * // 使用具名 alias
 * const codara = createCodara({alias: 'sonnet'});
 *
 * // 高级用法：直接传 model 实例
 * const codara = createCodara({model: customChatModel});
 * ```
 */
export function createCodara(options: CodaraOptions = {}): Codara {
  return createCodaraInstance(options);
}

function createCodaraInstance(
  options: CodaraOptions,
  restoredState?: SessionState,
): Codara {
  const guidelinesSource = createCodaraGuidelinesSource({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    userHome: options.userHome,
    guidelines: options.guidelines,
  });
  const skills = resolveCodaraSkills(options);
  const skillsSource = skills ? createCodaraSkillsSource(skills) : undefined;
  const alias = options.alias?.trim() || DEFAULT_CODARA_MODEL_ALIAS;
  const model = options.model ?? (options.modelResolver ? options.modelResolver() : undefined);
  const modelCatalog = model
    ? undefined
    : options.catalog ?? createCodaraModelCatalog({
      config: options.config,
    });
  const session = createSession({
    ...(restoredState ? {state: restoredState} : {}),
    sessionId: options.sessionId,
    threadId: options.threadId,
    store: options.store,
    checkpointer: options.checkpointer,
    restore: options.restore,
    messages: options.messages,
    context: options.context,
    values: options.values,
    modelRef: alias,
    ...(model ? {model} : {}),
    ...(modelCatalog ? {modelCatalog} : {}),
    guidelinesSource,
    ...(skillsSource ? {skillsSource} : {}),
    tools: createCodaraTools(options),
    ...(options.handleToolErrors !== undefined ? {handleToolErrors: options.handleToolErrors} : {}),
    middleware: createCodaraMiddlewares(options),
    ...(options.summary ? {summary: options.summary} : {}),
    ...(options.inputBudget ? {inputBudget: options.inputBudget} : {}),
  });
  const commands = createCodaraCommandRunner({
    getDynamicCommands: skillsSource
      ? () => createSkillCodaraCommands(skillsSource)
      : undefined,
    host: createCodaraCommandHost(session),
  });

  return {
    ...session,
    listCommands: commands.listCommands,
    executeCommand: commands.executeCommand,
  };
}

export async function openCodaraSession(
  options: CodaraOptions & {
    sessionId: string;
    store: SessionStore;
  }
): Promise<Codara> {
  const sessionState = await options.store.get(options.sessionId);
  if (!sessionState) {
    throw new Error(`Session not found: ${options.sessionId}`);
  }

  return openStoredCodaraSession(options, sessionState);
}

export async function openLatestCodaraSession(
  options: CodaraOptions & {
    store: SessionStore;
  }
): Promise<Codara> {
  const latest = await resolveLatestSession(options.store);
  if (!latest) {
    throw new Error('No sessions found');
  }

  return openStoredCodaraSession(options, latest);
}

function createCodaraCommandHost(
  session: Session,
): CodaraCommandHost {
  return {
    compactConversation: (compactOptions: {instructions?: string} | undefined) => session.compactConversation(compactOptions),
    compactCheckpoints: (keepLast: number | undefined) => session.compactCheckpoints(
      typeof keepLast === 'number' ? {keepLast} : undefined
    ),
    hydrate: () => session.hydrate(),
    getAgentState: () => session.getAgentState(),
    inspectAgentsFiles: () => session.inspectAgentsFiles(),
    ensureAgentsFileTarget: (scope: 'global' | 'project') => session.ensureAgentsFileTarget(scope),
    invokePrompt: (input: string) => session.invoke(input),
    reloadSources: () => session.reloadSources(),
    async resumePause(payload: {
      decision: 'approve' | 'reject';
      feedback?: string;
    }) {
      await session.resumePause(payload, {
        ...(payload.feedback ? {input: payload.feedback} : {}),
      });
      return session.getAgentState();
    },
  };
}

async function openStoredCodaraSession(
  options: CodaraOptions,
  sessionState: SessionState,
): Promise<Codara> {
  const codara = createCodaraInstance({
    ...options,
    sessionId: sessionState.sessionId,
    threadId: sessionState.threadId,
    restore: 'latest',
  }, sessionState);

  await codara.hydrate();
  return codara;
}

async function resolveLatestSession(store: SessionStore): Promise<SessionState | undefined> {
  const sessions = await store.list({
    includeArchived: true,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  });

  const latestReadyHost = sessions.find((session) => session.sessionStatus !== 'closed');
  return latestReadyHost ?? sessions[0];
}

export function createCodaraTools(options: CodaraToolsOptions = {}): StructuredToolInterface[] {
  const extraTools = options.tools ?? [];
  if (options.builtinTools === false) {
    return [...extraTools];
  }

  const builtinTools = createBuiltinTools({cwd: options.cwd});
  const byName = new Map<string, StructuredToolInterface>();
  for (const tool of builtinTools) {
    byName.set(tool.name, tool);
  }
  for (const tool of extraTools) {
    byName.set(tool.name, tool);
  }
  return Array.from(byName.values());
}

export function createCodaraMiddlewares(
  options: CodaraMiddlewareOptions = {},
): BaseMiddleware[] {
  const middlewares: BaseMiddleware[] = [];
  if (options.logging && options.logging.enabled !== false) {
    middlewares.push(createLoggingMiddleware(options.logging));
  }
  middlewares.push(...(options.middleware ?? []));
  middlewares.push(createConversationContextMiddleware({
    summary: options.summary,
  }));
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
