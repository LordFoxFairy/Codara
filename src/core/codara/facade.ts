import {createSession} from '@core/sessions';
import {createCodaraSourceProvider} from '@core/sessions/source-provider';
import {createCodaraModelCatalog} from '@core/codara/models';
import {createCodaraTools} from '@core/codara/tools';
import {createCodaraMiddlewares} from '@core/codara/middleware';
import {createCodaraCommandRunner} from '@core/codara/commands';
import {ensureCodaraMemoryTarget, inspectCodaraMemory} from '@core/codara/memory';
import type {Codara, CodaraOptions} from '@core/codara/types';
import type {SessionState, SessionStore} from '@core/sessions';

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
  const sourceProvider = createCodaraSourceProvider({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    userHome: options.userHome,
    guidelines: options.guidelines,
  });

  const modelCatalog = options.catalog ?? createCodaraModelCatalog({
    config: options.config,
  });

  // 支持 modelResolver 作为 model 的替代
  const model = options.model ?? (options.modelResolver ? options.modelResolver() : undefined);

  const tools = createCodaraTools(options);
  const middleware = createCodaraMiddlewares(options, sourceProvider);

  const session = createSession({
    ...(restoredState ? {state: restoredState} : {}),
    sessionId: options.sessionId,
    threadId: options.threadId,
    alias: options.alias ?? 'default',
    model,
    modelCatalog,
    sourceProvider,
    store: options.store,
    tools,
    middleware,
    checkpointer: options.checkpointer,
    restore: options.restore,
    inputBudget: options.inputBudget,
    messages: options.messages,
    context: options.context,
    values: options.values,
  });
  const commands = createCodaraCommandRunner({
    compactConversation: (compactOptions) => session.compactConversation(compactOptions),
    compactCheckpoints: (keepLast) => session.compactCheckpoints(
      typeof keepLast === 'number' ? {keepLast} : undefined
    ),
    getAgentState: () => session.getAgentState(),
    inspectMemory: () => inspectCodaraMemory({
      cwd: options.cwd,
      projectRoot: options.projectRoot,
      userHome: options.userHome,
      guidelines: options.guidelines,
    }),
    ensureMemoryTarget: (scope) => ensureCodaraMemoryTarget({
      cwd: options.cwd,
      projectRoot: options.projectRoot,
      userHome: options.userHome,
      guidelines: options.guidelines,
    }, scope),
    reloadSources: () => session.reloadSources(),
    async resumePause(payload) {
      await session.resumePause(payload, {
        ...(payload.feedback ? {input: payload.feedback} : {}),
      });
      return session.getAgentState();
    },
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

  const codara = createCodaraInstance({
    ...options,
    sessionId: sessionState.sessionId,
    threadId: sessionState.threadId,
    restore: 'latest',
  }, sessionState);

  await codara.hydrate();
  return codara;
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

  const codara = createCodaraInstance({
    ...options,
    sessionId: latest.sessionId,
    threadId: latest.threadId,
    restore: 'latest',
  }, latest);

  await codara.hydrate();
  return codara;
}

async function resolveLatestSession(store: SessionStore): Promise<SessionState | undefined> {
  const sessions = await store.list({
    includeArchived: true,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
    limit: 1,
  });
  return sessions[0];
}
