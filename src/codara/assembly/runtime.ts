/**
 * Model catalog & factory -- wraps ModelRegistry + ChatModelFactory into
 * the `CodaraModelCatalog` class used for alias-based model resolution.
 */

import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {
  ChatModelFactory,
  loadModelRoutingConfig,
  ModelRegistry,
  type ModelInfo,
} from '@models';
import type {
  CreateCodaraModelCatalogOptions,
  CreateCodaraChatModelOptions,
} from '../types';

export const DEFAULT_CODARA_MODEL_ALIAS = 'default';

/** Alias-aware model catalog that resolves model aliases to ChatModel instances. */
export class CodaraModelCatalog {
  constructor(
    private readonly registry: ModelRegistry,
    private readonly factory: ChatModelFactory,
  ) {}

  create(alias = DEFAULT_CODARA_MODEL_ALIAS): Promise<BaseChatModel> {
    return this.factory.create(normalizeCodaraAlias(alias));
  }

  getInfo(alias = DEFAULT_CODARA_MODEL_ALIAS): ModelInfo {
    return this.registry.getByAlias(normalizeCodaraAlias(alias));
  }

  hasAlias(alias: string): boolean {
    return this.registry.hasAlias(normalizeCodaraAlias(alias));
  }

  getAliases(): string[] {
    return this.registry.getAliases();
  }
}

export async function createCodaraModelCatalog(
  options: CreateCodaraModelCatalogOptions = {},
): Promise<CodaraModelCatalog> {
  const config = options.config ?? (await loadModelRoutingConfig());
  const registry = new ModelRegistry(config);
  return new CodaraModelCatalog(registry, new ChatModelFactory(registry));
}

export async function createCodaraChatModel(
  options: CreateCodaraChatModelOptions = {},
): Promise<BaseChatModel> {
  const catalog = await (options.catalog ?? createCodaraModelCatalog(options));
  return catalog.create(options.alias);
}

export function normalizeCodaraAlias(alias: string | undefined): string {
  return alias?.trim() || DEFAULT_CODARA_MODEL_ALIAS;
}
