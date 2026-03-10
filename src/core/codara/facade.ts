import {createSession} from '@core/sessions';
import {createCodaraCommandRunner} from '@core/codara/commands';
import {ensureAgentsFileTarget, inspectAgentsFiles} from '@core/sessions/agents-files';
import type {Codara, CodaraOptions} from '@core/codara/types';
import type {SessionState, SessionStore} from '@core/sessions';
import {createCodaraRuntimePlan} from '@core/codara/runtime';

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
  const runtime = createCodaraRuntimePlan(options);
  const session = createSession({
    ...(restoredState ? {state: restoredState} : {}),
    sessionId: options.sessionId,
    threadId: options.threadId,
    alias: runtime.alias,
    model: runtime.model,
    modelCatalog: runtime.modelCatalog,
    agentsSource: runtime.agentsSource,
    store: options.store,
    tools: runtime.tools,
    middleware: runtime.middleware,
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
    inspectAgentsFiles: () => inspectAgentsFiles({
      cwd: options.cwd,
      projectRoot: options.projectRoot,
      userHome: options.userHome,
      guidelines: options.guidelines,
    }),
    ensureAgentsFileTarget: (scope) => ensureAgentsFileTarget({
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
