import type {ModelInfo, ModelRoutingConfig, RouterRule} from "./model";
import {resolveApiKey} from "./utils";

/**
 * 根据模型 ID 推断 provider。
 */
export function inferProvider(modelId: string): string {
    return modelId.split("/")[0] === "anthropic" ? "anthropic" : "openai";
}

/**
 * 模型解析器。
 */
export class ModelResolver {
    private readonly models: ModelInfo[];
    private readonly modelMap: Map<string, ModelInfo>;

    constructor(config: ModelRoutingConfig) {
        this.models = config.routerRules
            .map((rule) => this.resolveRule(rule, config))
            .filter((m): m is ModelInfo => m !== null);
        this.modelMap = new Map(this.models.map((m) => [m.displayName, m]));
    }

    getAll(): ModelInfo[] {
        return [...this.models];
    }

    getByAlias(alias: string): ModelInfo {
        const model = this.modelMap.get(alias);
        if (!model) throw new Error(`❌ 别名 "${alias}" 不存在`);
        return model;
    }

    hasAlias(alias: string): boolean {
        return this.modelMap.has(alias);
    }

    getAliases(): string[] {
        return Array.from(this.modelMap.keys());
    }

    private resolveRule(rule: RouterRule, config: ModelRoutingConfig): ModelInfo | null {
        const {provider: providerName, model: modelId, alias} = rule;

        const providerConfig = config.providers.find((p) => p.name === providerName);
        if (!providerConfig) {
            console.warn(`⚠️  跳过规则 "${alias}": Provider "${providerName}" 未定义`);
            return null;
        }
        if (!providerConfig.models.includes(modelId)) {
            console.warn(`⚠️  跳过规则 "${alias}": 模型 "${modelId}" 不在 provider "${providerName}" 的白名单中`);
            return null;
        }

        return {
            provider: providerName,
            model: modelId,
            type: providerName === "anthropic" ? "anthropic" : "openai",
            displayName: alias,
            baseUrl: providerConfig.baseUrl,
            apiKey: resolveApiKey(providerConfig.apiKey),
        };
    }
}

