import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {ModelInfo, ModelRoutingConfig} from '@core/provider';
import {ChatModelFactory, loadModelRoutingConfig, ModelRegistry} from '@core/provider';

export const DEFAULT_CODARA_MODEL_ALIAS = 'default';

export interface CreateCodaraModelRuntimeOptions {
  /**
   * 可复用外部已加载的模型路由配置。
   * 未提供时默认加载 `~/.codara/config.json`。
   */
  config?: ModelRoutingConfig;
}

export interface CreateCodaraChatModelOptions extends CreateCodaraModelRuntimeOptions {
  /**
   * 路由别名。
   * 默认使用 `default`，便于 CLI/终端直接取项目主模型。
   */
  alias?: string;
  runtime?: CodaraModelRuntime;
}

/**
 * Codara 对外的模型运行时。
 * 负责封装配置加载、别名查找和模型实例创建，让宿主只按 alias 切换模型，
 * 不必重复拼装 `loadModelRoutingConfig -> ModelRegistry -> ChatModelFactory`。
 */
export class CodaraModelRuntime {
  constructor(
    private readonly registry: ModelRegistry,
    private readonly factory: ChatModelFactory
  ) {}

  create(alias = DEFAULT_CODARA_MODEL_ALIAS): Promise<BaseChatModel> {
    return this.factory.create(normalizeModelAlias(alias));
  }

  getInfo(alias = DEFAULT_CODARA_MODEL_ALIAS): ModelInfo {
    return this.registry.getByAlias(normalizeModelAlias(alias));
  }

  hasAlias(alias: string): boolean {
    return this.registry.hasAlias(normalizeModelAlias(alias));
  }

  getAliases(): string[] {
    return this.registry.getAliases();
  }
}

export async function createCodaraModelRuntime(
  options: CreateCodaraModelRuntimeOptions = {}
): Promise<CodaraModelRuntime> {
  const config = options.config ?? (await loadModelRoutingConfig());
  const registry = new ModelRegistry(config);
  const factory = new ChatModelFactory(registry);
  return new CodaraModelRuntime(registry, factory);
}

export async function createCodaraChatModel(
  options: CreateCodaraChatModelOptions = {}
): Promise<BaseChatModel> {
  const runtime = options.runtime ?? (await createCodaraModelRuntime(options));
  return runtime.create(options.alias);
}

function normalizeModelAlias(alias: string | undefined): string {
  const resolved = alias?.trim() || DEFAULT_CODARA_MODEL_ALIAS;
  if (!resolved) {
    return DEFAULT_CODARA_MODEL_ALIAS;
  }
  return resolved;
}
