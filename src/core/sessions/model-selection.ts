import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {CreateSessionOptions} from '@core/sessions/types';
import type {ModelInfo} from '@core/provider';
import {deriveAgentInputBudget} from '@core/agents/input-budget';

export async function resolveSessionModelSelection(options: CreateSessionOptions): Promise<{
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

export function resolveSessionInputBudget(
  options: CreateSessionOptions,
  modelInfo?: Pick<ModelInfo, 'contextWindow' | 'maxOutputTokens'>,
) {
  return options.inputBudget ?? deriveAgentInputBudget(modelInfo);
}
