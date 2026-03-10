import type {AgentInputBudget} from '@core/agents/contract/agent';
import type {ModelInfo} from '@core/provider';

export function deriveAgentInputBudget(
  modelInfo: Pick<ModelInfo, 'contextWindow' | 'maxOutputTokens'> | undefined,
): AgentInputBudget | undefined {
  if (!modelInfo?.contextWindow) {
    return undefined;
  }

  return {
    maxInputTokens: modelInfo.contextWindow,
    ...(typeof modelInfo.maxOutputTokens === 'number'
      ? {reservedTokens: modelInfo.maxOutputTokens}
      : {}),
  };
}
