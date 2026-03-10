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

export function resolveSessionInputBudget(
  options: CreateSessionOptions,
  modelInfo?: Pick<ModelInfo, 'contextWindow' | 'maxOutputTokens'>,
) {
  return options.inputBudget ?? deriveAgentInputBudget(modelInfo);
}
