/**
 * Public session API types.
 *
 * Holds the {@link Session} interface and {@link CreateSessionOptions} that
 * consumers use to create and drive sessions. Extracted from session.ts so
 * that file stays focused on runtime orchestration.
 *
 * @module
 */

import type {BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {
  AgentInput,
  AgentInputBudget,
  AgentInvokeConfig,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentResult,
  AgentState,
  AgentStreamConfig,
  AgentStreamOutput,
  AgentRuntimeContext,
  ReviewResumePayload,
  ToolErrorHandler,
} from '@shared/agent-types';
import type {CompactOptions} from '@state/checkpoint/types';
import type {AgentCheckpointer} from '@state/checkpoint/agent';
import type {SessionLifecycleHooks} from '@hooks/types';
import type {GuidelinesSource, PromptSource} from '@context/sources';
import type {SkillsSource} from '@skills';
import type {DynamicSectionRegistry} from '@context/dynamic-sections';
import type {CodaraRuntimeEventListener} from '@events';
import type {SessionStore} from './store';
import type {SessionModelCatalog} from './session-bootstrap';
import type {AgentFactory, SessionMetadata, SessionMiddlewareFactory, SessionState} from './types';

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

export interface ConversationCompactionResult {
  state: AgentState;
  outcome: 'compacted' | 'skipped';
  reason?: 'hook' | 'noop';
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
