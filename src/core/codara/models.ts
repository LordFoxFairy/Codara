import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {ModelInfo, ModelRoutingConfig} from '@core/provider';
import {ChatModelFactory, loadModelRoutingConfig, ModelRegistry} from '@core/provider';

export const DEFAULT_CODARA_MODEL_ALIAS = 'default';

export interface CreateCodaraModelCatalogOptions {
  /** 可复用外部已加载的模型路由配置。 */
  config?: ModelRoutingConfig;
}

export interface CreateCodaraChatModelOptions extends CreateCodaraModelCatalogOptions {
  /** 路由别名，默认使用 `default`。 */
  alias?: string;
  catalog?: CodaraModelCatalog;
}

/** Codara 模型目录，负责将别名解析为真实聊天模型。 */
export class CodaraModelCatalog {
  constructor(
    private readonly registry: ModelRegistry,
    private readonly factory: ChatModelFactory
  ) {}

  create(alias = DEFAULT_CODARA_MODEL_ALIAS): Promise<BaseChatModel> {
    return this.factory.create(normalizeAlias(alias));
  }

  getInfo(alias = DEFAULT_CODARA_MODEL_ALIAS): ModelInfo {
    return this.registry.getByAlias(normalizeAlias(alias));
  }

  hasAlias(alias: string): boolean {
    return this.registry.hasAlias(normalizeAlias(alias));
  }

  getAliases(): string[] {
    return this.registry.getAliases();
  }
}

export async function createCodaraModelCatalog(
  options: CreateCodaraModelCatalogOptions = {}
): Promise<CodaraModelCatalog> {
  const config = options.config ?? (await loadModelRoutingConfig());
  const registry = new ModelRegistry(config);
  const factory = new ChatModelFactory(registry);
  return new CodaraModelCatalog(registry, factory);
}

export async function createCodaraChatModel(
  options: CreateCodaraChatModelOptions = {}
): Promise<BaseChatModel> {
  const catalog = options.catalog ?? (await createCodaraModelCatalog(options));
  return catalog.create(options.alias);
}

function normalizeAlias(alias: string | undefined): string {
  return alias?.trim() || DEFAULT_CODARA_MODEL_ALIAS;
}
