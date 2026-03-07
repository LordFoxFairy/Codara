import type {
  AgentInput,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentRunConfig,
} from '@core/agents/agent';
import type {AgentStreamConfig, AgentStreamOutput} from '@core/agents/stream';
import type {AgentResult} from '@core/agents/types';
import type {AgentInstanceState} from '@core/checkpoint/state';
import type {HILResumePayload} from '@core/middleware';

interface CodaraSessionAgent {
  invoke(input?: AgentInput, config?: AgentRunConfig): Promise<AgentResult>;
  stream(input?: AgentInput, config?: AgentStreamConfig): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  resume(payload: HILResumePayload, config?: AgentResumeConfig): Promise<AgentResult>;
  resumeStream(
    payload: HILResumePayload,
    config?: AgentResumeStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  getState(): AgentInstanceState;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

type CodaraQueryResult = Awaited<ReturnType<CodaraSessionAgent['invoke']>>;
type CodaraResumeResult = Awaited<ReturnType<CodaraSessionAgent['resume']>>;

export interface CodaraSession {
  query(input?: AgentInput, config?: AgentRunConfig): Promise<CodaraQueryResult>;
  stream(
    input?: AgentInput,
    config?: AgentStreamConfig
  ): AsyncGenerator<AgentStreamOutput, CodaraQueryResult, void>;
  resume(payload: HILResumePayload, config?: AgentResumeConfig): Promise<CodaraResumeResult>;
  resumeStream(
    payload: HILResumePayload,
    config?: AgentResumeStreamConfig
  ): AsyncGenerator<AgentStreamOutput, CodaraResumeResult, void>;
  getState(): AgentInstanceState;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

export function createCodaraSession(agent: CodaraSessionAgent): CodaraSession {
  return {
    query(input, config) {
      return agent.invoke(input, config);
    },
    stream(input, config) {
      return agent.stream(input, config);
    },
    resume(payload, config) {
      return agent.resume(payload, config);
    },
    resumeStream(payload, config) {
      return agent.resumeStream(payload, config);
    },
    getState() {
      return agent.getState();
    },
    reset() {
      return agent.reset();
    },
    dispose() {
      return agent.dispose();
    },
  };
}
