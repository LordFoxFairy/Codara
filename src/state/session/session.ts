/**
 * Core session lifecycle.
 *
 * A Session is the top-level stateful container for a single conversation.
 * It owns:
 * - An agent instance (lazily bootstrapped via {@link bootstrapSessionAgent})
 * - A checkpointer for persistence across process restarts
 * - Runtime event emission for the CLI/UI layer
 * - Lifecycle hooks (session start/end, prompt veto, pre/post compact)
 *
 * The closure-based factory (`createSession`) keeps internal state private
 * while exposing a clean {@link Session} interface. This is intentional --
 * the session has ~15 pieces of mutable state that should not leak.
 *
 * Architecture comparison with Claude Code:
 * - Claude Code uses a Zustand-style store (`createStore` in `state/store.ts`)
 *   with `AppStateStore` holding messages + UI state in one flat object.
 * - Codara separates concerns: session state (this file) owns agent lifecycle,
 *   while the CLI layer (`cli/app/`) owns UI projection. The session never
 *   touches rendering.
 *
 * Most closure-internal mechanics (lifecycle hooks, stream iteration,
 * fork/mutation helpers) live in sibling `session-*.ts` files; this file
 * only wires them together.
 *
 * @module
 */

import {randomUUID} from 'node:crypto';
import type {BaseMessage} from '@langchain/core/messages';
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
} from '@shared/agent-types';
import type {CompactOptions} from '@state/checkpoint/types';
import {
  createAgentMemoryCheckpointer,
  type AgentCheckpointer,
} from '@state/checkpoint/agent';
import type {SessionLifecycleHooks} from '@hooks/types';
import type {GuidelinesSource, PromptSource} from '@context/sources';
import type {SkillsSource} from '@skills';
import type {DynamicSectionRegistry} from '@context/dynamic-sections';
import {
  createSessionMetadata,
  forkSessionMetadata,
  syncSessionMetadata,
} from './metadata';
import type {SessionStore} from './store';
import {
  RuntimeEventsController,
  type CodaraRuntimeEventListener,
} from '@events';
import type {AgentFactory, SessionMetadata, SessionMiddlewareFactory, SessionState, SessionStatus} from './types';
import type {AgentPreparationContext, AgentRuntimeContext} from '@shared/agent-types';
import {
  bootstrapSessionAgent,
  loadBaseInstructionContext,
  type SessionModelCatalog,
} from './session-bootstrap';
import {applyPreparedInstructionContext, type BaseSystemMessageBundle} from '@context/system-message';
import {compactConversation as doCompactConversation} from './session-compact';
import {
  checkPromptVeto,
  fireSessionEndHook,
  fireSessionStartHook,
  safeLifecycleCall,
} from './session-lifecycle';
import {
  runHilResume,
  runOperation,
  runStreamOperation,
  type SyncFn,
  type SyncOptions,
} from './session-invoke';
import {
  focusReview as focusReviewHelper,
  replaceMessages as replaceMessagesHelper,
  updateContext as updateContextHelper,
  writeForkCheckpoint,
} from './session-fork';

export type {CodaraRuntimeEvent, CodaraRuntimeEventListener} from '@events';
export type {SessionModelCatalog} from './session-bootstrap';

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
  dynamicSections?: DynamicSectionRegistry;
  store?: SessionStore;
  tools?: StructuredToolInterface[];
  handleToolErrors?: ToolErrorHandler;
  middleware?: unknown[];
  checkpointer?: AgentCheckpointer;
  summary?: false | unknown;
  restore?: 'latest' | 'never';
  inputBudget?: AgentInputBudget;
  messages?: AgentInput;
  context?: Record<string, unknown>;
  values?: Record<string, unknown>;
  metadata?: Partial<SessionMetadata>;
  lifecycle?: SessionLifecycleHooks;
  /** Agent creation factory — required for decoupled session operation. */
  agentFactory: AgentFactory;
  /** Middleware factory — required for summary/middleware operations. */
  middlewareFactory: SessionMiddlewareFactory;
}

export interface Session {
  /** Lightweight session metadata (id, status, timestamps). */
  getState(): SessionState;
  /** Full agent state including messages, context, values, pending review. */
  getAgentState(): AgentState;
  /** Patch agent context and persist a new checkpoint. */
  updateContext(context: AgentRuntimeContext): Promise<AgentState>;
  /** Replace the entire message array and persist a new checkpoint. */
  replaceMessages(messages: BaseMessage[]): Promise<AgentState>;
  /** Names of all tools available to the agent (from tools + middleware). */
  getAvailableToolNames(): string[];
  /** Subscribe to runtime events (model responding, review, summary, etc.). Returns unsubscribe function. */
  subscribeRuntimeEvents(listener: CodaraRuntimeEventListener): () => void;
  /** Bootstrap the agent (if needed) and sync metadata. Idempotent. */
  hydrate(): Promise<AgentState>;
  /** Summarize the conversation to reduce context window usage. */
  compactConversation(options?: {instructions?: string}): Promise<ConversationCompactionResult>;
  /** Create a child session from the current agent state. */
  fork(options?: {id?: string; sessionId?: string; store?: SessionStore}): Promise<Session>;
  /** Send a prompt and wait for the full result. */
  invoke(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult>;
  /** Send a prompt and stream intermediate chunks. */
  stream(input?: AgentInput, config?: AgentStreamConfig): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  /** Resume from a human-in-the-loop review decision (non-streaming). */
  resumeReview(payload: ReviewResumePayload, config?: AgentResumeConfig): Promise<AgentResult>;
  /** Resume from a human-in-the-loop review decision (streaming). */
  resumeReviewStream(
    payload: ReviewResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  /** Reload prompt/guidelines/skills sources and invalidate the agent cache. */
  reloadSources(): Promise<void>;
  /** Prune old checkpoint history (delegates to checkpointer.compact). */
  compactCheckpoints(options?: CompactOptions): Promise<void>;
  /** Clear agent state (messages, context) while keeping the session alive. */
  reset(): Promise<void>;
  /** Shut down the session: fire lifecycle hooks, persist final state. */
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
  let summaryOptions: unknown;
  let baseSystemContext: BaseSystemMessageBundle | undefined;
  const runtimeEvents = new RuntimeEventsController(sessionId);
  const lifecycle = options.lifecycle;
  let sessionStarted = false;

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

    for (const middleware of (options.middleware ?? []) as Array<{tools?: Array<{name?: string}>}>) {
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

  const sync: SyncFn = async (next, syncOptions: SyncOptions = {}) => {
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
  };

  async function loadInstructionContext(forceReload = false): Promise<BaseSystemMessageBundle> {
    if (forceReload || !baseSystemContext) {
      baseSystemContext = await loadBaseInstructionContext(
        {
          promptSource: options.promptSource,
          guidelinesSource: options.guidelinesSource,
          skillsSource: options.skillsSource,
          dynamicSections: options.dynamicSections,
        },
        forceReload,
        baseSystemContext,
      );
    }
    return baseSystemContext;
  }

  function requireAgent(): Agent {
    if (!agent) {
      throw new Error('Agent not initialized. Call invoke/stream first.');
    }
    return agent;
  }

  async function applySessionContext(context: AgentPreparationContext): Promise<void> {
    const next = await loadInstructionContext();
    applyPreparedInstructionContext(context, next);
  }

  async function getAgent(): Promise<Agent> {
    if (agent) {
      return agent;
    }
    if (!agentPromise) {
      agentPromise = (async () => {
        try {
          const result = await bootstrapSessionAgent({
            sessionId,
            model: options.model,
            modelRef: options.modelRef,
            modelCatalog: options.modelCatalog,
            promptSource: options.promptSource,
            guidelinesSource: options.guidelinesSource,
            skillsSource: options.skillsSource,
            dynamicSections: options.dynamicSections,
            tools: options.tools,
            handleToolErrors: options.handleToolErrors,
            middleware: options.middleware,
            summary: options.summary,
            messages: options.messages,
            context: options.context,
            values: options.values,
            agentFactory: options.agentFactory,
            middlewareFactory: options.middlewareFactory,
            runtimeEvents,
            checkpointer,
            restoreCheckpoint,
            inputBudget,
            getLatestCheckpoint,
            prepareContext: applySessionContext,
          });
          agent = result.agent;
          summaryOptions = result.summaryOptions;
          inputBudget = result.inputBudget;
          baseSystemContext = result.baseSystemContext;
          return result.agent;
        } finally {
          if (!agent) {
            clearAgentCache();
          }
        }
      })();
    }
    return agentPromise;
  }

  function ensureReady() {
    if (sessionStatus === 'closed') {
      throw new Error('Session is closed.');
    }
  }

  async function fork(optionsOverride: {id?: string; sessionId?: string; store?: SessionStore} = {}) {
    const childSessionId = resolveSessionId(undefined, {
      id: optionsOverride.id,
      sessionId: optionsOverride.sessionId,
    });
    await writeForkCheckpoint({sessionId, checkpointer, getAgent}, childSessionId);

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

  const mutateDeps = {
    sessionId,
    checkpointer,
    getAgent,
    getLatestCheckpoint,
    clearAgentCache,
    sync,
  };

  async function focusReview(request: ReviewRequest): Promise<AgentState> {
    ensureReady();
    return focusReviewHelper(mutateDeps, request);
  }

  async function updateContext(contextPatch: AgentRuntimeContext): Promise<AgentState> {
    ensureReady();
    return updateContextHelper(mutateDeps, contextPatch);
  }

  async function replaceMessages(messages: BaseMessage[]): Promise<AgentState> {
    ensureReady();
    return replaceMessagesHelper(mutateDeps, messages);
  }

  async function ensureSessionStart(): Promise<void> {
    sessionStarted = await fireSessionStartHook({sessionId, lifecycle}, sessionStarted);
  }

  async function maybeVetoPrompt(input: AgentInput | undefined): Promise<AgentResult | undefined> {
    return checkPromptVeto(
      {
        sessionId,
        lifecycle,
        getAgentState: async () => (await getAgent()).getState(),
      },
      input,
    );
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
    async compactConversation(compactOptions = {}) {
      ensureReady();
      return doCompactConversation({
        sessionId,
        summary: options.summary,
        summaryOptions,
        inputBudget,
        middlewareFactory: options.middlewareFactory,
        runtimeEvents,
        lifecycle,
        checkpointer,
        getAgent,
        getLatestCheckpoint,
        loadBaseInstructionContext: () => loadInstructionContext(),
        clearAgentCache,
        sync: (agentState) => sync(agentState),
        safeLifecycleCall,
      }, compactOptions);
    },
    async fork(forkOptions = {}) {
      ensureReady();
      return fork(forkOptions);
    },
    async invoke(input, config) {
      ensureReady();
      await ensureSessionStart();
      const vetoResult = await maybeVetoPrompt(input);
      if (vetoResult) {
        return vetoResult;
      }
      return runOperation(getAgent, sync, (instance) => instance.invoke(input, config));
    },
    async *stream(input, config) {
      ensureReady();
      await ensureSessionStart();
      const vetoResult = await maybeVetoPrompt(input);
      if (vetoResult) {
        return vetoResult;
      }
      return yield* runStreamOperation(
        getAgent,
        sync,
        runtimeEvents,
        (instance) => instance.stream(input, config),
      );
    },
    async resumeReview(payload, config) {
      ensureReady();
      const instance = await getAgent();
      return runHilResume(
        runtimeEvents,
        instance.getState().pendingReview?.description,
        () => runOperation(getAgent, sync, (current) => current.resume(payload, config)),
      );
    },
    async *resumeReviewStream(payload, config) {
      ensureReady();
      const pendingDescription = (await getAgent()).getState().pendingReview?.description;
      const eventId = runtimeEvents.reviewResumeStarted(
        pendingDescription?.trim() ? `Resuming review: ${pendingDescription.trim()}` : 'Applying review selection',
      );

      try {
        const result = yield* runStreamOperation(
          getAgent,
          sync,
          runtimeEvents,
          (instance) => instance.resumeStream(payload, config),
        );
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
      await loadInstructionContext(true);
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
      await fireSessionEndHook({sessionId, lifecycle});
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
