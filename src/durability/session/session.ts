import {randomUUID} from 'node:crypto';
import {AIMessageChunk, type BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {
  Agent,
  AgentInput,
  AgentInputBudget,
  AgentInvokeConfig,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentResult,
  AgentState,
  AgentStreamConfig,
  AgentStreamOutput,
  ReviewRequest,
  ReviewResumePayload,
  ToolErrorHandler,
} from '@core/agent/models/agent';
import {normalizeAgentInput} from '@core/agent/run/agent-loop';
import {bootstrapAgent} from '@core/agent/bootstrap';
import type {CompactOptions} from '@durability/checkpoint/types';
import {
  createAgentMemoryCheckpointer,
  putForkCheckpoint,
  putManualCheckpoint,
  type AgentCheckpointer,
} from '@durability/checkpoint/agent';
import {MIDDLEWARE_NAMES, type BaseMiddleware} from '@core/pipeline/types';
import {
  compactConversationWithSummary,
  createModelSummaryGenerator,
  createSummaryMiddleware,
  resolveSummaryOptions,
  type SummaryOptions,
  type SummarySettings,
} from '@core/middleware/summary';
import type {SessionLifecycleHooks} from '@observability/hook/types';
import type {GuidelinesSource} from '@context/instructions/guidelines';
import {type PromptSource} from '@context/prompts/prompt-source';
import type {SkillsSource} from '@capability/skill';
import {
  type AutoMemoryRuntime,
  shouldRecordAutoMemoryTurn,
} from '@context/memory/auto-memory';
import {
  applyPreparedInstructionContext,
  buildBaseSystemMessage,
  type BaseSystemMessageBundle,
} from '@context/session-bundle/base-system-message';
import type {ModelInfo} from '@integration/provider';
import {
  createSessionMetadata,
  deriveSessionInputBudget,
  forkSessionMetadata,
  syncSessionMetadata,
} from './metadata';
import type {SessionStore} from './store';
import {
  RuntimeEventsController,
  type CodaraRuntimeEventListener,
} from '@observability/events';
import type {SessionMetadata, SessionState, SessionStatus} from './types';
import type {AgentRuntimeContext} from '@shared/contracts/agent-types';
import {mergeContext as mergeAgentContext} from '@core/agent/models/command';
export type {CodaraRuntimeEvent, CodaraRuntimeEventListener} from '@observability/events';

export interface SessionModelCatalog {
  create(modelRef?: string): Promise<BaseChatModel>;
  getInfo(modelRef?: string): ModelInfo;
}

export interface CreateSessionOptions {
  state?: SessionState;
  id?: string;
  sessionId?: string;
  modelRef?: string;
  model?: BaseChatModel | Promise<BaseChatModel>;
  modelCatalog?: SessionModelCatalog | Promise<SessionModelCatalog>;
  guidelinesSource?: GuidelinesSource;
  promptSource?: PromptSource;
  skillsSource?: SkillsSource;
  autoMemory?: AutoMemoryRuntime;
  store?: SessionStore;
  tools?: StructuredToolInterface[];
  handleToolErrors?: ToolErrorHandler;
  middleware?: BaseMiddleware[];
  checkpointer?: AgentCheckpointer;
  summary?: false | SummarySettings;
  restore?: 'latest' | 'never';
  inputBudget?: AgentInputBudget;
  messages?: AgentInput;
  context?: Record<string, unknown>;
  values?: Record<string, unknown>;
  metadata?: Partial<SessionMetadata>;
  lifecycle?: SessionLifecycleHooks;
}

export interface Session {
  getState(): SessionState;
  getAgentState(): AgentState;
  updateContext(context: AgentRuntimeContext): Promise<AgentState>;
  replaceMessages(messages: BaseMessage[]): Promise<AgentState>;
  getAvailableToolNames(): string[];
  subscribeRuntimeEvents(listener: CodaraRuntimeEventListener): () => void;
  hydrate(): Promise<AgentState>;
  compactConversation(options?: {instructions?: string}): Promise<ConversationCompactionResult>;
  fork(options?: {id?: string; sessionId?: string; store?: SessionStore}): Promise<Session>;
  invoke(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult>;
  stream(input?: AgentInput, config?: AgentStreamConfig): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  resumeReview(payload: ReviewResumePayload, config?: AgentResumeConfig): Promise<AgentResult>;
  resumeReviewStream(
    payload: ReviewResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  reloadSources(): Promise<void>;
  compactCheckpoints(options?: CompactOptions): Promise<void>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

export interface ConversationCompactionResult {
  state: AgentState;
  outcome: 'compacted' | 'skipped';
  reason?: 'hook' | 'noop';
}

export function createSession(options: CreateSessionOptions): Session {
  const restored = options.state;
  const sessionId = resolveSessionId(restored, {
    id: options.id,
    sessionId: options.sessionId,
  });
  const createdAt = restored?.createdAt ?? new Date().toISOString();
  let updatedAt = restored?.updatedAt ?? createdAt;
  let sessionStatus: SessionStatus = 'ready';
  const metadata = createSessionMetadata(createdAt, restored?.metadata, options.metadata);
  const checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
  const restoreCheckpoint = options.restore !== 'never';
  let inputBudget = options.inputBudget;
  let agent: Agent | undefined;
  let agentPromise: Promise<Agent> | undefined;
  let summaryOptions: Required<SummaryOptions> | undefined;
  let baseSystemContext: BaseSystemMessageBundle | undefined;
  const runtimeEvents = new RuntimeEventsController(sessionId);
  const lifecycle = options.lifecycle;
  let sessionStarted = false;

  async function safeLifecycleCall<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch {
      // Lifecycle hooks are best-effort and should not break the session.
    }
  }

  async function ensureSessionStartHook(): Promise<void> {
    if (sessionStarted || !lifecycle) {
      return;
    }
    sessionStarted = true;
    await safeLifecycleCall(() =>
      lifecycle.onSessionStart({
        sessionId,
        hookEvent: 'SessionStart',
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
      }),
    );
  }

  async function checkPromptVeto(input: AgentInput | undefined): Promise<AgentResult | undefined> {
    if (!lifecycle || input == null) {
      return undefined;
    }
    const prompt = extractPromptText(input);
    if (!prompt) {
      return undefined;
    }
    const result = await safeLifecycleCall(() =>
      lifecycle.onUserPromptSubmit({
        sessionId,
        hookEvent: 'UserPromptSubmit',
        timestamp: new Date().toISOString(),
        userPrompt: prompt,
      }),
    );
    if (result?.vetoed) {
      const agentState = (await getAgent()).getState();
      return {
        reason: 'complete',
        state: agentState,
        turns: 0,
        error: result.vetoReason ? new Error(result.vetoReason) : undefined,
      };
    }
    return undefined;
  }

  function state(): SessionState {
    return {sessionId, sessionStatus, createdAt, updatedAt, metadata};
  }

  function getAvailableToolNames(): string[] {
    const names = new Set<string>();

    for (const tool of options.tools ?? []) {
      const name = tool.name?.trim();
      if (name) {
        names.add(name);
      }
    }

    for (const middleware of options.middleware ?? []) {
      for (const tool of middleware.tools ?? []) {
        const name = tool.name?.trim();
        if (name) {
          names.add(name);
        }
      }
    }

    return [...names];
  }

  function touch() {
    updatedAt = new Date().toISOString();
    metadata.lastActivity = updatedAt;
  }

  function clearAgentCache() {
    agent = undefined;
    agentPromise = undefined;
    summaryOptions = undefined;
  }

  async function persistSessionState(touchActivity = true) {
    if (touchActivity) {
      touch();
    }
    if (options.store) {
      await options.store.save(sessionId, state());
    }
  }

  async function getLatestCheckpoint() {
    return checkpointer.getLatest(sessionId);
  }

  async function hasStoredCheckpoint() {
    return Boolean(await getLatestCheckpoint());
  }

  async function sync(
    next: AgentState,
    syncOptions: {touchActivity?: boolean; collectUsage?: boolean; previousMessages?: readonly BaseMessage[]} = {},
  ) {
    if (syncOptions.touchActivity !== false) {
      touch();
    }

    syncSessionMetadata(metadata, next, {
      inputBudget,
      collectUsage: syncOptions.collectUsage,
      previousMessages: syncOptions.previousMessages,
    });
    if (options.store) {
      await options.store.save(sessionId, state());
    }
  }

  async function loadBaseInstructionContext(forceReload = false): Promise<{
    systemMessage: string[];
    runtimeShared?: Record<string, unknown>;
  }> {
    if (forceReload || !baseSystemContext) {
      options.promptSource?.reload?.();
      options.guidelinesSource?.reload?.();
      options.skillsSource?.reload();
      options.autoMemory?.source.reload();
      baseSystemContext = await buildBaseSystemMessage({
        promptSource: options.promptSource,
        guidelinesSource: options.guidelinesSource,
        skillsSource: options.skillsSource,
        autoMemorySource: options.autoMemory?.source,
        memoryRootDir: options.autoMemory?.rootDir,
      });
    }

    return baseSystemContext;
  }

  function requireAgent(): Agent {
    if (!agent) {
      throw new Error('Agent not initialized. Call invoke/stream first.');
    }
    return agent;
  }

  async function getAgent(): Promise<Agent> {
    if (agent) {
      return agent;
    }
    if (!agentPromise) {
      agentPromise = bootstrapSessionAgent().then((instance) => {
        agent = instance;
        return instance;
      }).finally(() => {
        if (!agent) {
          clearAgentCache();
        }
      });
    }
    return agentPromise;
  }

  async function bootstrapSessionAgent(): Promise<Agent> {
    const systemContext = await loadBaseInstructionContext();
    const modelSelection = await resolveSessionModel(options);
    const checkpoint = restoreCheckpoint ? await getLatestCheckpoint() : undefined;

    inputBudget = options.inputBudget ?? deriveSessionInputBudget(modelSelection.modelInfo);
    summaryOptions = options.summary
      ? resolveSummaryOptions(options.summary, createModelSummaryGenerator(modelSelection.model))
      : undefined;

    return bootstrapAgent({
      model: modelSelection.model,
      agentType: 'main',
      tools: options.tools,
      handleToolErrors: options.handleToolErrors,
      middleware: buildSessionMiddleware(summaryOptions),
      checkpointer,
      sessionId,
      inputBudget,
      ...(checkpoint ? {checkpoint} : {}),
      ...(options.messages ? {messages: normalizeAgentInput(options.messages)} : {}),
      ...(options.context ? {context: options.context} : {}),
      ...(options.values ? {values: options.values} : {}),
      ...(systemContext.systemMessage.length > 0 ? {systemMessage: systemContext.systemMessage} : {}),
      ...(systemContext.runtimeShared ? {runtimeShared: systemContext.runtimeShared} : {}),
      prepareContext: applySessionContext,
    });
  }

  function buildSessionMiddleware(summary: Required<SummaryOptions> | undefined): BaseMiddleware[] | undefined {
    const middlewares = [
      runtimeEvents.createMiddleware(),
      ...(options.middleware ?? []),
    ];
    if (!summary || middlewares.some((middleware) => middleware.name === MIDDLEWARE_NAMES.Summary)) {
      return middlewares.length > 0 ? middlewares : undefined;
    }

    const summaryMiddleware = createSummaryMiddleware({summary});
    if (!summaryMiddleware) {
      return middlewares.length > 0 ? middlewares : undefined;
    }

    const reviewIndex = middlewares.findIndex((middleware) => middleware.name === MIDDLEWARE_NAMES.Review);
    if (reviewIndex < 0) {
      middlewares.push(summaryMiddleware);
      return middlewares;
    }

    middlewares.splice(reviewIndex, 0, summaryMiddleware);
    return middlewares;
  }

  function ensureReady() {
    if (sessionStatus === 'closed') {
      throw new Error('Session is closed.');
    }
  }

  async function run(operation: (instance: Agent) => Promise<AgentResult>) {
    const instance = await getAgent();
    const previousMessages = [...instance.getState().messages];
    const result = await operation(instance);
    await recordAutoMemory(previousMessages, result.state.messages, result);
    await sync(result.state, {collectUsage: true, previousMessages});
    return result;
  }

  async function* runStream(operation: (instance: Agent) => AsyncGenerator<AgentStreamOutput, AgentResult, void>) {
    const instance = await getAgent();
    const previousMessages = [...instance.getState().messages];
    let sawModelResponse = false;
    const stream = operation(instance);
    let result: AgentResult | undefined;
    while (true) {
      const next = await stream.next();
      if (next.done) {
        result = next.value;
        break;
      }

      if (!sawModelResponse && AIMessageChunk.isInstance(next.value)) {
        const runId = readResponseMetadataString(next.value.response_metadata, 'runId');
        const turn = readResponseMetadataNumber(next.value.response_metadata, 'turn');
        if (runId && typeof turn === 'number' && next.value.text?.trim()) {
          runtimeEvents.modelResponding(runId, turn);
          sawModelResponse = true;
        }
      }

      yield next.value;
    }

    if (!result) {
      throw new Error('Stream finished without an AgentResult.');
    }

    await recordAutoMemory(previousMessages, result.state.messages, result);
    await sync(result.state, {collectUsage: true, previousMessages});
    return result;
  }

  async function applySessionContext(context: import('@core/agent').AgentPreparationContext): Promise<void> {
    const next = await loadBaseInstructionContext();
    applyPreparedInstructionContext(context, next);
  }

  async function recordAutoMemory(
    previousMessages: readonly BaseMessage[],
    nextMessages: readonly BaseMessage[],
    result: AgentResult,
  ): Promise<void> {
    if (!options.autoMemory || !shouldRecordAutoMemoryTurn(result)) {
      return;
    }

    try {
      await options.autoMemory.recordTurn({
        previousMessages,
        nextMessages,
        sessionId,
      });
    } catch (error) {
      // Auto memory is best-effort and should not break the turn lifecycle.
      console.warn('[session] Auto-memory recording failed:', error instanceof Error ? error.message : String(error));
    }
  }

  async function fork(optionsOverride: {id?: string; sessionId?: string; store?: SessionStore} = {}) {
    const base = (await getAgent()).getState();
    const childSessionId = resolveSessionId(undefined, {
      id: optionsOverride.id,
      sessionId: optionsOverride.sessionId,
    });
    await putForkCheckpoint(checkpointer, childSessionId, {
      agentType: base.agentType,
      messages: base.messages,
      context: base.context,
      values: base.values,
      ...(base.pendingReview ? {pendingReview: base.pendingReview} : {}),
    });

    const child = createSession({
      ...options,
      id: childSessionId,
      sessionId: childSessionId,
      store: optionsOverride.store ?? options.store,
      restore: 'latest',
      metadata: forkSessionMetadata(metadata, sessionId),
    });
    await child.hydrate();
    return child;
  }

  async function compactConversation(compactOptions: {instructions?: string} = {}) {
    ensureReady();
    if (!options.summary) {
      throw new Error('Conversation compaction is not configured for this session.');
    }

    const instance = await getAgent();
    const summary = summaryOptions;

    if (!summary) {
      throw new Error('Conversation compaction is not configured for this session.');
    }

    const current = instance.getState();
    if (current.status === 'running') {
      throw new Error('Agent is currently running.');
    }
    if (current.status === 'paused') {
      throw new Error('Agent is paused; resume(...) or reset() before compacting the conversation.');
    }

    const summaryEventId = runtimeEvents.summaryStarted('Compacting context');

    if (lifecycle) {
      const preResult = await safeLifecycleCall(() =>
        lifecycle.onPreCompact({
          sessionId,
          hookEvent: 'PreCompact',
          timestamp: new Date().toISOString(),
          messageCount: current.messages.length,
        }),
      );
      if (preResult?.vetoed) {
        runtimeEvents.summaryFinished(summaryEventId, 'done', 'Context compact skipped by hook');
        return {
          state: current,
          outcome: 'skipped',
          reason: 'hook',
        } satisfies ConversationCompactionResult;
      }
    }

    const systemContext = await loadBaseInstructionContext();
    const compacted = await compactConversationWithSummary({
      messages: current.messages,
      context: current.context,
      values: current.values,
      systemMessage: systemContext.systemMessage,
      runtimeShared: systemContext.runtimeShared,
      sessionId,
      requestId: `${sessionId}:compact:${randomUUID()}`,
      inputBudget,
      instructions: compactOptions.instructions,
    }, summary);

    if (!compacted) {
      await sync(current);
      runtimeEvents.summaryFinished(summaryEventId, 'done', 'Context compact skipped');
      return {
        state: current,
        outcome: 'skipped',
        reason: 'noop',
      } satisfies ConversationCompactionResult;
    }

    await putManualCheckpoint(checkpointer, sessionId, {
      agentType: current.agentType,
      messages: compacted.messages,
      context: compacted.context,
      values: compacted.values,
    }, await getLatestCheckpoint());

    clearAgentCache();
    const next = (await getAgent()).getState();
    await sync(next);

    if (lifecycle) {
      await safeLifecycleCall(() =>
        lifecycle.onPostCompact({
          sessionId,
          hookEvent: 'PostCompact',
          timestamp: new Date().toISOString(),
          messageCount: next.messages.length,
        }),
      );
    }

    runtimeEvents.summaryFinished(summaryEventId, 'done', 'Context compacted');
    return {
      state: next,
      outcome: 'compacted',
    } satisfies ConversationCompactionResult;
  }

  async function runHilResume<T>(operation: () => Promise<T>, pendingDescription: string | undefined): Promise<T> {
    const eventId = runtimeEvents.reviewResumeStarted(
      pendingDescription?.trim() ? `Resuming review: ${pendingDescription.trim()}` : 'Applying review selection',
    );

    try {
      const result = await operation();
      runtimeEvents.reviewResumeFinished(eventId, 'done', 'Review selection applied');
      return result;
    } catch (error) {
      runtimeEvents.reviewResumeFinished(
        eventId,
        'error',
        'Review selection failed',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async function focusReview(request: ReviewRequest): Promise<AgentState> {
    ensureReady();
    const current = (await getAgent()).getState();

    if (current.pendingReview?.id === request.id) {
      return current;
    }

    await putManualCheckpoint(checkpointer, sessionId, {
      agentType: current.agentType,
      messages: current.messages,
      context: current.context,
      values: current.values,
      pendingReview: request,
    }, await getLatestCheckpoint());

    clearAgentCache();
    const next = (await getAgent()).getState();
    await sync(next, {touchActivity: false});
    return next;
  }

  async function updateContext(contextPatch: AgentRuntimeContext): Promise<AgentState> {
    ensureReady();
    const current = (await getAgent()).getState();
    const nextContext = applyContextPatch(current.context, contextPatch);

    await putManualCheckpoint(checkpointer, sessionId, {
      agentType: current.agentType,
      messages: current.messages,
      context: nextContext,
      values: current.values,
      ...(current.pendingReview ? {pendingReview: current.pendingReview} : {}),
    }, await getLatestCheckpoint());

    clearAgentCache();
    const next = (await getAgent()).getState();
    await sync(next, {touchActivity: false});
    return next;
  }

  async function replaceMessages(messages: BaseMessage[]): Promise<AgentState> {
    ensureReady();
    const current = (await getAgent()).getState();

    await putManualCheckpoint(checkpointer, sessionId, {
      agentType: current.agentType,
      messages,
      context: current.context,
      values: current.values,
      ...(current.pendingReview ? {pendingReview: current.pendingReview} : {}),
    }, await getLatestCheckpoint());

    clearAgentCache();
    const next = (await getAgent()).getState();
    await sync(next, {touchActivity: false});
    return next;
  }

  const session: Session & {
    focusReview: (request: ReviewRequest) => Promise<AgentState>;
  } = {
    getState: state,
    getAgentState() {
      return requireAgent().getState();
    },
    updateContext,
    replaceMessages,
    getAvailableToolNames,
    subscribeRuntimeEvents(listener) {
      return runtimeEvents.subscribe(listener);
    },
    async hydrate() {
      ensureReady();
      const next = (await getAgent()).getState();
      await sync(next, {touchActivity: false});
      return next;
    },
    compactConversation,
    async fork(forkOptions = {}) {
      ensureReady();
      return fork(forkOptions);
    },
    async invoke(input, config) {
      ensureReady();
      await ensureSessionStartHook();
      const vetoResult = await checkPromptVeto(input);
      if (vetoResult) {
        return vetoResult;
      }
      return run((instance) => instance.invoke(input, config));
    },
    async *stream(input, config) {
      ensureReady();
      await ensureSessionStartHook();
      const vetoResult = await checkPromptVeto(input);
      if (vetoResult) {
        return vetoResult;
      }
      return yield* runStream((instance) => instance.stream(input, config));
    },
    async resumeReview(payload, config) {
      ensureReady();
      const instance = await getAgent();
      return runHilResume(
        () => run((current) => current.resume(payload, config)),
        instance.getState().pendingReview?.description,
      );
    },
    async *resumeReviewStream(payload, config) {
      ensureReady();
      const pendingDescription = (await getAgent()).getState().pendingReview?.description;
      const eventId = runtimeEvents.reviewResumeStarted(
        pendingDescription?.trim() ? `Resuming review: ${pendingDescription.trim()}` : 'Applying review selection',
      );

      try {
        const result = yield* runStream((instance) => instance.resumeStream(payload, config));
        runtimeEvents.reviewResumeFinished(eventId, 'done', 'Review selection applied');
        return result;
      } catch (error) {
        runtimeEvents.reviewResumeFinished(
          eventId,
          'error',
          'Review selection failed',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    },
    async reloadSources() {
      ensureReady();
      await loadBaseInstructionContext(true);
      clearAgentCache();
      await persistSessionState();
    },
    async compactCheckpoints(optionsOverride) {
      ensureReady();
      if (!checkpointer.compact) {
        return;
      }
      await checkpointer.compact(sessionId, optionsOverride);
      await persistSessionState();
    },
    async reset() {
      ensureReady();
      // If bootstrap is in-flight, await it before deciding whether to clean up.
      if (!agent && agentPromise) {
        try {
          await agentPromise;
        } catch { /* bootstrap may have failed */ }
      }
      if (!agent && !(await hasStoredCheckpoint())) {
        await persistSessionState();
        return;
      }
      const instance = await getAgent();
      await instance.reset();
      await sync(instance.getState());
    },
    async dispose() {
      if (sessionStatus === 'closed') {
        return;
      }
      if (lifecycle) {
        await safeLifecycleCall(() =>
          lifecycle.onSessionEnd({
            sessionId,
            hookEvent: 'SessionEnd',
            timestamp: new Date().toISOString(),
            reason: 'user_exit',
          }),
        );
      }
      // If bootstrap is in-flight, await it before deciding whether to clean up.
      if (!agent && agentPromise) {
        try {
          await agentPromise;
        } catch { /* bootstrap may have failed */ }
      }
      if (!agent && !(await hasStoredCheckpoint())) {
        sessionStatus = 'closed';
        await persistSessionState();
        return;
      }
      await (await getAgent()).dispose();
      sessionStatus = 'closed';
      await persistSessionState();
    },
    focusReview,
  };

  return session;
}

function applyContextPatch(current: AgentRuntimeContext, patch: AgentRuntimeContext): AgentRuntimeContext {
  const normalizedPatch: AgentRuntimeContext = {};

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      normalizedPatch[key] = value;
    }
  }

  const merged = mergeAgentContext(current ?? {}, normalizedPatch);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete merged[key];
    }
  }
  return merged;
}

function readResponseMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readResponseMetadataNumber(
  metadata: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function resolveSessionId(
  restored: SessionState | undefined,
  input: {
    id?: string;
    sessionId?: string;
  } = {},
): string {
  const restoredSessionId = restored?.sessionId?.trim();
  return restoredSessionId || input.id || input.sessionId || randomUUID();
}

function extractPromptText(input: AgentInput): string | undefined {
  if (typeof input === 'string') {
    return input.trim() || undefined;
  }
  if (input && typeof input === 'object' && 'messages' in input && Array.isArray(input.messages)) {
    const last = input.messages[input.messages.length - 1];
    if (last && typeof last.content === 'string') {
      return last.content.trim() || undefined;
    }
  }
  if (Array.isArray(input)) {
    const last = input[input.length - 1];
    if (last && typeof last.content === 'string') {
      return last.content.trim() || undefined;
    }
  }
  if (input && typeof input === 'object' && 'content' in input) {
    const content = (input as BaseMessage).content;
    if (typeof content === 'string') {
      return content.trim() || undefined;
    }
  }
  return undefined;
}

async function resolveSessionModel(
  options: CreateSessionOptions,
): Promise<{model: BaseChatModel; modelInfo?: ModelInfo}> {
  if (options.model) {
    return {model: await options.model};
  }

  if (!options.modelCatalog) {
    throw new Error('Either model or modelCatalog must be provided');
  }

  const catalog = await options.modelCatalog;
  const modelRef = options.modelRef ?? 'default';
  return {model: await catalog.create(modelRef), modelInfo: catalog.getInfo(modelRef)};
}
