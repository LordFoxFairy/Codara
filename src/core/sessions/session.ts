import {randomUUID} from 'node:crypto';
import type {
  Agent,
  AgentInput,
  AgentInvokeConfig,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentResult,
  AgentState,
  AgentStreamConfig,
  AgentStreamOutput,
} from '@core/agents';
import {createAgent, normalizeAgentInput} from '@core/agents';
import {createAgentMemoryCheckpointer, type CompactOptions} from '@core/checkpoint';
import type {ResumePayload} from '@core/agents/contract/pause';
import {deriveAgentInputBudget} from '@core/agents/input-budget';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {
  cloneAgentContext,
  cloneAgentMessages,
  cloneAgentValues,
  clonePauseRequest,
} from '@core/agents/engine/state';
import type {
  CreateSessionOptions,
  Session,
  SessionMetadata,
  SessionState,
  SessionStatus,
} from '@core/sessions/types';
import {
  buildSessionTelemetryPatch,
  cloneForkSessionMetadata,
  createSessionMetadata,
  mergeSessionTelemetry,
  touchSessionMetadata,
  updateSessionMetadataFromAgentState,
} from '@core/sessions/metadata';
import type {ModelInfo} from '@core/provider';
import {
  formatSkillsList,
  formatSkillsLocations,
  SKILLS_SYSTEM_PROMPT,
  type SkillsRuntimeData,
} from '@core/knowledge/skills';
import {readSkillsRuntimeData} from '@core/knowledge/skills/runtime';
import {normalizeSummaryOptions} from '@core/middleware/conversation';

/**
 * 创建 session 实例。
 * Session 是唯一 host lifecycle owner，负责：
 * - source preload / reload
 * - agent lazy bootstrap / restore
 * - session metadata persistence
 * - reopen / hydrate / reset / dispose host behavior
 */
export function createSession(options: CreateSessionOptions): Session {
  const restoredState = options.state;
  const sessionId = restoredState?.sessionId ?? options.sessionId ?? randomUUID();
  const threadId = restoredState?.threadId ?? options.threadId ?? randomUUID();
  const isRestoringThread = options.threadId !== undefined;
  const createdAt = restoredState?.createdAt ?? new Date().toISOString();
  let updatedAt = restoredState?.updatedAt ?? createdAt;
  let sessionStatus: SessionStatus = 'ready';
  const metadata: SessionMetadata = createSessionMetadata(
    createdAt,
    restoredState?.metadata,
    options.metadata,
  );
  const store = options.store;
  const checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
  let agentInstance: Agent | undefined;
  let agentBootstrap: Promise<Agent> | undefined;
  let guidelinesSystemMessage: string | undefined;
  let skillsRuntimeSnapshot: SkillsRuntimeData | undefined;
  let skillsSystemMessage: string | undefined;

  function touch(): void {
    updatedAt = new Date().toISOString();
    touchSessionMetadata(metadata, updatedAt);
  }

  async function touchAndSaveSession(): Promise<void> {
    touch();
    await saveSession();
  }

  async function saveSession(): Promise<void> {
    if (!store) {
      return;
    }

    await store.save(sessionId, {
      sessionId,
      threadId,
      sessionStatus,
      createdAt,
      updatedAt,
      metadata,
    });
  }

  function updateMetadataFromState(agentState: AgentState): void {
    updateSessionMetadataFromAgentState(metadata, agentState);
  }

  async function syncSessionFromState(
    agentState: AgentState,
    syncOptions: {
      touchActivity?: boolean;
      applyTelemetry?: boolean;
      previousState?: Pick<AgentState, 'messages'>;
    } = {},
  ): Promise<void> {
    if (syncOptions.touchActivity !== false) {
      touch();
    }

    updateMetadataFromState(agentState);
    if (syncOptions.applyTelemetry) {
      mergeSessionTelemetry(metadata, buildSessionTelemetryPatch(agentState, syncOptions.previousState));
    }
    await saveSession();
  }

  async function reloadHostSources(): Promise<void> {
    options.guidelinesSource?.reload();
    options.skillsSource?.reload();
    guidelinesSystemMessage = undefined;
    skillsRuntimeSnapshot = undefined;
    skillsSystemMessage = undefined;
    await preloadHostSources();
  }

  async function preloadHostSources(): Promise<void> {
    guidelinesSystemMessage = await options.guidelinesSource?.getContent?.();
    skillsRuntimeSnapshot = await options.skillsSource?.getRuntime?.();
    skillsSystemMessage = skillsRuntimeSnapshot
      ? createSkillsSystemMessage(skillsRuntimeSnapshot)
      : undefined;
  }

  async function hasStoredCheckpoint(): Promise<boolean> {
    return Boolean(await checkpointer.getLatest(threadId));
  }

  async function getAgent(): Promise<Agent> {
    if (agentInstance) {
      return agentInstance;
    }

    if (agentBootstrap) {
      return agentBootstrap;
    }

    agentBootstrap = initializeAgent().then((agent) => {
      agentInstance = agent;
      return agent;
    });

    try {
      return await agentBootstrap;
    } finally {
      agentBootstrap = agentInstance ? Promise.resolve(agentInstance) : undefined;
    }
  }

  function requireInitializedAgent(): Agent {
    if (!agentInstance) {
      throw new Error('Agent not initialized. Call invoke/stream first.');
    }
    return agentInstance;
  }

  async function runAgentResult(
    operation: (agent: Agent) => Promise<AgentResult>,
  ): Promise<AgentResult> {
    const agent = await getAgent();
    const previousState = agent.getState();
    const result = await operation(agent);
    await syncSessionFromState(result.state, {applyTelemetry: true, previousState});
    return result;
  }

  async function* runAgentStreamResult(
    operation: (agent: Agent) => AsyncGenerator<AgentStreamOutput, AgentResult, void>,
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    const agent = await getAgent();
    const previousState = agent.getState();
    const result = yield* operation(agent);
    await syncSessionFromState(result.state, {applyTelemetry: true, previousState});
    return result;
  }

  function ensureReady(): void {
    if (sessionStatus === 'closed') {
      throw new Error('Session is closed.');
    }
  }

  function buildSessionState(): SessionState {
    return {
      sessionId,
      threadId,
      sessionStatus,
      createdAt,
      updatedAt,
      metadata,
    };
  }

  async function forkSession(
    forkOptions: {
      sessionId?: string;
      threadId?: string;
      store?: CreateSessionOptions['store'];
    } = {},
  ): Promise<Session> {
    const baseState = (await getAgent()).getState();
    const childThreadId = forkOptions.threadId ?? randomUUID();

    await checkpointer.put({
      threadId: childThreadId,
      state: {
        agentType: baseState.agentType,
        messages: cloneAgentMessages(baseState.messages),
        context: cloneAgentContext(baseState.context),
        values: cloneAgentValues(baseState.values),
        ...(baseState.pendingPause ? {pendingPause: clonePauseRequest(baseState.pendingPause)} : {}),
      },
      info: {
        source: 'fork',
        status: baseState.pendingPause ? 'paused' : 'idle',
        step: 0,
        createdAt: new Date().toISOString(),
      },
    });

    const child = createSession({
      ...options,
      sessionId: forkOptions.sessionId,
      threadId: childThreadId,
      store: forkOptions.store ?? options.store,
      restore: 'latest',
      metadata: {
        ...cloneForkSessionMetadata(metadata),
        forkedFromSessionId: sessionId,
        forkedFromThreadId: threadId,
      },
    });
    await child.hydrate();
    return child;
  }

  async function resetSession(): Promise<void> {
    if (!agentInstance && !await hasStoredCheckpoint()) {
      await touchAndSaveSession();
      return;
    }

    const agent = await getAgent();
    await agent.reset();
    await syncSessionFromState(agent.getState());
  }

  async function disposeSession(): Promise<void> {
    if (sessionStatus === 'closed') {
      return;
    }

    if (!agentInstance && !await hasStoredCheckpoint()) {
      sessionStatus = 'closed';
      await touchAndSaveSession();
      return;
    }

    await (await getAgent()).dispose();
    sessionStatus = 'closed';
    await touchAndSaveSession();
  }

  async function initializeAgent(): Promise<Agent> {
    await preloadHostSources();
    const selection = await resolveModelSelection();
    const shouldRestore = options.restore === 'latest'
      || (options.restore !== 'never' && isRestoringThread);
    const checkpoint = shouldRestore
      ? await checkpointer.getLatest(threadId)
      : undefined;
    const messages = options.messages
      ? normalizeAgentInput(options.messages)
      : undefined;

    return createAgent({
      model: selection.model,
      tools: options.tools,
      handleToolErrors: options.handleToolErrors,
      middleware: options.middleware,
      checkpointer,
      threadId,
      inputBudget: options.inputBudget ?? deriveAgentInputBudget(selection.modelInfo),
      ...(options.summary ? {summary: normalizeSummaryOptions(options.summary)} : {}),
      prepareTurnContext: composePrepareTurnContext(),
      ...(checkpoint ? {checkpoint} : {}),
      ...(messages ? {messages} : {}),
      ...(options.context ? {context: options.context} : {}),
      ...(options.values ? {values: options.values} : {}),
    });
  }

  async function resolveModelSelection(): Promise<{
    model: BaseChatModel;
    modelInfo?: ModelInfo;
  }> {
    if (options.model) {
      return {
        model: await options.model,
      };
    }

    if (!options.modelCatalog) {
      throw new Error('Either model or modelCatalog must be provided');
    }

    const catalog = await options.modelCatalog;
    const modelRef = options.modelRef ?? 'default';
    return {
      model: await catalog.create(modelRef),
      modelInfo: catalog.getInfo(modelRef),
    };
  }

  function requireGuidelinesActions() {
    const source = options.guidelinesSource;
    if (!source?.inspectFiles || !source.ensureFileTarget) {
      throw new Error('AGENTS file actions are not available for this session.');
    }
    return {
      inspectFiles: source.inspectFiles.bind(source),
      ensureFileTarget: source.ensureFileTarget.bind(source),
    };
  }

  function composePrepareTurnContext() {
    if (!guidelinesSystemMessage && !skillsRuntimeSnapshot && !options.prepareTurnContext) {
      return undefined;
    }

    return async (context: Parameters<NonNullable<CreateSessionOptions['prepareTurnContext']>>[0]) => {
      if (guidelinesSystemMessage) {
        context.systemMessage.push(guidelinesSystemMessage);
      }

      if (skillsRuntimeSnapshot) {
        const shared = context.runtime.shared ?? (context.runtime.shared = {});
        if (!readSkillsRuntimeData(shared)) {
          shared.skills = skillsRuntimeSnapshot;
        }

        if (skillsSystemMessage) {
          context.systemMessage.push(skillsSystemMessage);
        }
      }

      await options.prepareTurnContext?.(context);
    };
  }

  return {
    getState(): SessionState {
      return buildSessionState();
    },

    getAgentState(): AgentState {
      return requireInitializedAgent().getState();
    },

    async hydrate(): Promise<AgentState> {
      ensureReady();
      const state = (await getAgent()).getState();
      await syncSessionFromState(state, {touchActivity: false});
      return state;
    },

    async compactConversation(compactOptions = {}): Promise<AgentState> {
      ensureReady();
      const state = await (await getAgent()).compactConversation(compactOptions);
      await syncSessionFromState(state);
      return state;
    },

    async fork(forkOptions = {}): Promise<Session> {
      ensureReady();
      return forkSession(forkOptions);
    },

    async invoke(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult> {
      ensureReady();
      return runAgentResult((agent) => agent.invoke(input, config));
    },

    async *stream(
      input?: AgentInput,
      config?: AgentStreamConfig,
    ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
      ensureReady();
      return yield* runAgentStreamResult((agent) => agent.stream(input, config));
    },

    async resumePause(payload: ResumePayload, config?: AgentResumeConfig): Promise<AgentResult> {
      ensureReady();
      return runAgentResult((agent) => agent.resume(payload, config));
    },

    async *resumePauseStream(
      payload: ResumePayload,
      config?: AgentResumeStreamConfig,
    ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
      ensureReady();
      return yield* runAgentStreamResult((agent) => agent.resumeStream(payload, config));
    },

    async reloadSources(): Promise<void> {
      ensureReady();
      await reloadHostSources();
      await touchAndSaveSession();
    },

    async inspectAgentsFiles() {
      ensureReady();
      return requireGuidelinesActions().inspectFiles();
    },

    async ensureAgentsFileTarget(scope) {
      ensureReady();
      return requireGuidelinesActions().ensureFileTarget(scope);
    },

    async compactCheckpoints(compactOptions?: CompactOptions): Promise<void> {
      ensureReady();
      if (!checkpointer.compact) {
        return;
      }

      await checkpointer.compact(threadId, compactOptions);
      await touchAndSaveSession();
    },

    async reset(): Promise<void> {
      ensureReady();
      return resetSession();
    },

    async dispose(): Promise<void> {
      await disposeSession();
    },
  };
}

function createSkillsSystemMessage(
  runtime: Pick<SkillsRuntimeData, 'sources' | 'discovered'>,
): string {
  return SKILLS_SYSTEM_PROMPT
    .replace('{skills_locations}', formatSkillsLocations(runtime.sources))
    .replace('{skills_list}', formatSkillsList(runtime.discovered, runtime.sources));
}
