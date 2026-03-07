import {createAgent, type Agent} from '@core/agents';
import type {AgentCheckpoint} from '@core/checkpoint/state';
import type {AgentResult, AgentStreamConfig, AgentStreamOutput} from '@core/agents';
import {
  type CreateSessionOptions,
  type LoadSessionOptions,
  type SessionQueryConfig,
  type SessionQueryInput,
  type SessionResumeConfig,
  type SessionResumeStreamConfig,
  type SessionState,
} from '@core/sessions/types';
import type {HILResumePayload} from '@core/middleware/hil';

export interface Session {
  query(input?: SessionQueryInput, config?: SessionQueryConfig): Promise<AgentResult>;
  stream(
    input?: SessionQueryInput,
    config?: AgentStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  resume(payload: HILResumePayload, config?: SessionResumeConfig): Promise<AgentResult>;
  resumeStream(
    payload: HILResumePayload,
    config?: SessionResumeStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  getState(): SessionState;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

class AgentSession implements Session {
  constructor(private readonly agent: Agent) {}

  query(input?: SessionQueryInput, config?: SessionQueryConfig): Promise<AgentResult> {
    return this.agent.invoke(input, config);
  }

  stream(
    input?: SessionQueryInput,
    config?: AgentStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    return this.agent.stream(input, config);
  }

  resume(payload: HILResumePayload, config?: SessionResumeConfig): Promise<AgentResult> {
    return this.agent.resume(payload, config);
  }

  resumeStream(
    payload: HILResumePayload,
    config?: SessionResumeStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    return this.agent.resumeStream(payload, config);
  }

  getState(): SessionState {
    return this.agent.getState();
  }

  reset(): Promise<void> {
    return this.agent.reset();
  }

  dispose(): Promise<void> {
    return this.agent.dispose();
  }
}

export async function createSession(options: CreateSessionOptions): Promise<Session> {
  const agent = await createAgentForSession(options);
  return new AgentSession(agent);
}

export async function loadSession(options: LoadSessionOptions): Promise<Session | undefined> {
  const checkpoint = await options.checkpointer.getLatest(options.threadId);
  if (!checkpoint) {
    return undefined;
  }

  const agent = await createAgentForSession(options, checkpoint);
  return new AgentSession(agent);
}

async function createAgentForSession(options: CreateSessionOptions, checkpoint?: AgentCheckpoint): Promise<Agent> {
  const {messages, context, state, ...agentOptions} = options;
  const seed =
    state || messages || context
      ? {
          ...(state ?? {}),
          ...(messages ? {messages} : {}),
          ...(context ? {context} : {}),
        }
      : undefined;

  return createAgent({
    ...agentOptions,
    ...(checkpoint ? {checkpoint} : {}),
    ...(seed ? {state: seed} : {}),
  });
}
