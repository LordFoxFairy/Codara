import {createAgent, type Agent} from '@core/agents';
import type {AgentCheckpointer} from '@core/checkpoint/state';
import {resolveCodaraAgentOptions} from '@core/codara/assembly';
import type {CodaraAgentOptions} from '@core/codara/types';

interface CodaraSourceProjection {
  guidelines?: string;
  memory?: string;
}

/** 创建带 Codara 默认装配的 agent。 */
export async function createCodaraAgent(
  options: CodaraAgentOptions = {},
  loadedSources: CodaraSourceProjection = {}
): Promise<Agent> {
  return createAgent(await resolveCodaraAgentOptions(options, loadedSources));
}

/** 按 thread 恢复最新的 Codara agent。 */
export async function loadCodaraAgent(
  options: CodaraAgentOptions & {threadId: string; checkpointer: AgentCheckpointer}
): Promise<Agent | undefined> {
  const checkpoint = await options.checkpointer.getLatest(options.threadId);
  if (!checkpoint) {
    return undefined;
  }

  return createCodaraAgent({...options, checkpoint});
}
