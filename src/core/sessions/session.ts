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
import {normalizeAgentInput} from '@core/agents/engine/runtime-input';
import type {HILResumePayload} from '@core/middleware';
import type {CreateSessionOptions, Session, SessionState, SessionStatus} from '@core/sessions/types';
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
  const createdAt = new Date().toISOString();
  let updatedAt = createdAt;
  let sessionStatus: SessionStatus = 'ready';
  let agentInstance: Agent | undefined;

  function touch(): void {
    updatedAt = new Date().toISOString();
  }

  async function getAgent(): Promise<Agent> {
    if (agentInstance) {
      return agentInstance;
    }

    // Lazy creation
    const selection = await resolveModelSelection(options);
    const checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();

    // 尝试恢复 checkpoint
    const checkpoint = options.restore === 'latest'
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
      };
    },

    getAgentState(): AgentState {
      if (!agentInstance) {
        throw new Error('Agent not initialized. Call invoke/stream first.');
      }
      return agentInstance.getState();
    },

    async invoke(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult> {
      requireReady();
      touch();
      const agent = await getAgent();
      return agent.invoke(input, config);
    },

    async *stream(
      input?: AgentInput,
      config?: AgentStreamConfig
    ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
      requireReady();
      touch();
      const agent = await getAgent();
      return yield* agent.stream(input, config);
    },

    async resume(payload: HILResumePayload, config?: AgentResumeConfig): Promise<AgentResult> {
      requireReady();
      touch();
      const agent = await getAgent();
      return agent.resume(payload, config);
    },

    async *resumeStream(
      payload: HILResumePayload,
      config?: AgentResumeStreamConfig
    ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
      requireReady();
      touch();
      const agent = await getAgent();
      return yield* agent.resumeStream(payload, config);
    },

    reloadSources(): void {
      requireReady();
      touch();
      if (options.sourceProvider) {
        options.sourceProvider.invalidateAll();
      }
    },

    async reset(): Promise<void> {
      requireReady();
      touch();
      if (agentInstance) {
        await agentInstance.reset();
      }
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
    },
  };
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
