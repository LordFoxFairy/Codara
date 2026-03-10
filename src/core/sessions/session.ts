import {randomUUID} from 'node:crypto';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {
  Agent,
  AgentInputBudget,
  AgentInput,
  AgentInvokeConfig,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentResult,
  AgentState,
  AgentStreamConfig,
  AgentStreamOutput,
} from '@core/agents';
import {createAgent} from '@core/agents';
import {createAgentMemoryCheckpointer} from '@core/checkpoint/state';
import type {CompactOptions} from '@core/checkpoint/types';
import {normalizeAgentInput} from '@core/agents/engine/runtime-input';
import type {HILResumePayload} from '@core/middleware';
import type {CreateSessionOptions, Session, SessionState, SessionStatus, SessionMetadata} from '@core/sessions/types';
import type {ModelInfo} from '@core/provider';

/**
 * 创建 session 实例。
 * Session 负责：
 * - source 配置持有与缓存管理
 * - agent 实例管理（lazy creation、checkpoint restore）
 * - 对外暴露 invoke/stream/resume 等方法
 */
export function createSession(options: CreateSessionOptions): Session {
  const sessionId = options.sessionId ?? randomUUID();
  const threadId = options.threadId ?? randomUUID();
  const isRestoringThread = options.threadId !== undefined;
  const createdAt = new Date().toISOString();
  let updatedAt = createdAt;
  let sessionStatus: SessionStatus = 'ready';
  let agentInstance: Agent | undefined;
  let agentBootstrap: Promise<Agent> | undefined;
  const metadata: SessionMetadata = {
    messageCount: 0,
    lastActivity: createdAt,
  };
  const store = options.store;
  const checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();

  function touch(): void {
    updatedAt = new Date().toISOString();
    metadata.lastActivity = updatedAt;
  }

  async function saveSession(): Promise<void> {
    if (store) {
      await store.save(sessionId, {
        sessionId,
        threadId,
        sessionStatus,
        createdAt,
        updatedAt,
        metadata,
      });
    }
  }

  function updateMetadataFromState(agentState: AgentState): void {
    metadata.messageCount = agentState.messages.length;

    const lastMessage = agentState.messages[agentState.messages.length - 1];
    const lastText = readMessageText(lastMessage?.content);
    if (lastText) {
      metadata.lastMessage = lastText.slice(0, 200);
    }

    if (!metadata.title) {
      const firstHuman = agentState.messages.find((message) => isMessageType(message, 'human'));
      const title = readMessageText(firstHuman?.content);
      if (title) {
        metadata.title = title.slice(0, 80);
      }
    }
  }

  async function syncSessionFromState(
    agentState: AgentState,
    options: {
      touchActivity?: boolean;
    } = {},
  ): Promise<void> {
    if (options.touchActivity !== false) {
      touch();
    }

    updateMetadataFromState(agentState);
    await saveSession();
  }

  async function getAgent(): Promise<Agent> {
    if (agentInstance) {
      return agentInstance;
    }

    if (agentBootstrap) {
      return agentBootstrap;
    }

    agentBootstrap = (async () => {
      // Lazy creation
      const selection = await resolveModelSelection(options);

      // Auto-restore: threadId provided = restore latest checkpoint
      // Explicit restore option overrides this behavior
      const shouldRestore = options.restore === 'latest'
        || (options.restore !== 'never' && isRestoringThread);

      const checkpoint = shouldRestore
        ? await checkpointer.getLatest(threadId)
        : undefined;

      // Normalize messages input
      const messages = options.messages ? normalizeAgentInput(options.messages) : undefined;

      agentInstance = createAgent({
        model: selection.model,
        tools: options.tools,
        middleware: options.middleware,
        checkpointer,
        threadId,
        inputBudget: options.inputBudget ?? deriveInputBudget(selection.modelInfo),
        ...(checkpoint ? {checkpoint} : {}),
        ...(messages ? {messages} : {}),
        ...(options.context ? {context: options.context} : {}),
        ...(options.values ? {values: options.values} : {}),
      });

      return agentInstance;
    })();

    try {
      return await agentBootstrap;
    } finally {
      if (agentInstance) {
        agentBootstrap = Promise.resolve(agentInstance);
      } else {
        agentBootstrap = undefined;
      }
    }
  }

  function requireReady(): void {
    if (sessionStatus === 'closed') {
      throw new Error('Session is closed.');
    }
  }

  return {
    getState(): SessionState {
      return {
        sessionId,
        threadId,
        sessionStatus,
        createdAt,
        updatedAt,
        metadata,
      };
    },

    getAgentState(): AgentState {
      if (!agentInstance) {
        throw new Error('Agent not initialized. Call invoke/stream first.');
      }
      return agentInstance.getState();
    },

    async hydrate(): Promise<AgentState> {
      requireReady();
      const agent = await getAgent();
      const state = agent.getState();
      await syncSessionFromState(state);
      return state;
    },

    async compactConversation(): Promise<AgentState> {
      requireReady();
      const agent = await getAgent();
      const state = await agent.compactConversation();
      await syncSessionFromState(state);
      return state;
    },

    async invoke(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult> {
      requireReady();
      const agent = await getAgent();
      const result = await agent.invoke(input, config);
      await syncSessionFromState(result.state);
      return result;
    },

    async *stream(
      input?: AgentInput,
      config?: AgentStreamConfig
    ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
      requireReady();
      const agent = await getAgent();
      const result = yield* agent.stream(input, config);
      await syncSessionFromState(result.state);
      return result;
    },

    async resumePause(payload: HILResumePayload, config?: AgentResumeConfig): Promise<AgentResult> {
      requireReady();
      const agent = await getAgent();
      const result = await agent.resume(payload, config);
      await syncSessionFromState(result.state);
      return result;
    },

    async *resumePauseStream(
      payload: HILResumePayload,
      config?: AgentResumeStreamConfig
    ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
      requireReady();
      const agent = await getAgent();
      const result = yield* agent.resumeStream(payload, config);
      await syncSessionFromState(result.state);
      return result;
    },

    reloadSources(): void {
      requireReady();
      touch();
      if (options.sourceProvider) {
        options.sourceProvider.invalidateAll();
      }
    },

    async compactCheckpoints(options?: CompactOptions): Promise<void> {
      requireReady();
      if (!checkpointer.compact) {
        return;
      }

      await checkpointer.compact(threadId, options);
    },

    async reset(): Promise<void> {
      requireReady();
      if (agentInstance) {
        await agentInstance.reset();
        await syncSessionFromState(agentInstance.getState());
        return;
      }
      touch();
      await saveSession();
    },

    async dispose(): Promise<void> {
      if (sessionStatus === 'closed') {
        return;
      }
      if (agentInstance) {
        await agentInstance.dispose();
      }
      sessionStatus = 'closed';
      touch();
      await saveSession();
    },
  };
}

function readMessageText(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  return content
    .flatMap((part) => {
      if (!part || typeof part !== 'object') {
        return [];
      }

      if ('type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string') {
        return [part.text];
      }

      return [];
    })
    .join('\n')
    .trim() || undefined;
}

function isMessageType(message: unknown, expected: string): boolean {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if ('_getType' in message && typeof message._getType === 'function') {
    return message._getType() === expected;
  }

  if ('type' in message && typeof message.type === 'string') {
    return message.type === expected;
  }

  return false;
}

async function resolveModelSelection(options: CreateSessionOptions): Promise<{
  model: BaseChatModel;
  modelInfo?: ModelInfo;
}> {
  if (options.model) {
    return {
      model: await Promise.resolve(options.model),
    };
  }

  if (!options.modelCatalog) {
    throw new Error('Either model or modelCatalog must be provided');
  }

  const catalog = await Promise.resolve(options.modelCatalog);
  const alias = options.alias ?? 'default';
  return {
    model: await catalog.create(alias),
    modelInfo: catalog.getInfo(alias),
  };
}

function deriveInputBudget(modelInfo: Pick<ModelInfo, 'contextWindow' | 'maxOutputTokens'> | undefined): AgentInputBudget | undefined {
  if (!modelInfo?.contextWindow) {
    return undefined;
  }

  return {
    maxInputTokens: modelInfo.contextWindow,
    ...(typeof modelInfo.maxOutputTokens === 'number' ? {reservedTokens: modelInfo.maxOutputTokens} : {}),
  };
}
