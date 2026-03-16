import type {ModelInfo, ModelMetadataConfig, ModelRoutingConfig, ProviderConfig, RouterRule} from "@infra/provider/model";
import {WELL_KNOWN_CONTEXT_WINDOWS} from "@infra/provider/model";
import {expandApiKey} from "@infra/provider/runtime/api-key";

/** 模型注册表与别名索引。 */
export class ModelRegistry {
    private readonly rules: RouterRule[];
    private readonly providerMap: Map<string, ProviderConfig>;
    private readonly modelMetadata: Record<string, ModelMetadataConfig>;
    private readonly aliasMap: Map<string, RouterRule>;
    private readonly resolvedModelMap = new Map<string, ModelInfo>();

    constructor(config: ModelRoutingConfig) {
        this.providerMap = new Map(config.providers.map((p) => [p.name, p]));
        this.modelMetadata = config.modelMetadata;
        const aliasSet = new Set<string>();

        this.rules = config.routerRules.map((rule) => {
            if (aliasSet.has(rule.alias)) {
                throw new Error(`路由规则 "${rule.alias}" 重复定义`);
            }
            aliasSet.add(rule.alias);
            this.validateRule(rule);
            return rule;
        });
        this.aliasMap = new Map(this.rules.map((rule) => [rule.alias, rule]));
    }

    /** 获取所有模型 */
    getAll(): ModelInfo[] {
        return this.rules.map((rule) => this.getByAlias(rule.alias));
    }

    /** 根据别名获取模型 */
    getByAlias(alias: string): ModelInfo {
        const cached = this.resolvedModelMap.get(alias);
        if (cached) {
            return cached;
        }

        const rule = this.aliasMap.get(alias);
        if (!rule) {
            throw new Error(`❌ 别名 "${alias}" 不存在`);
        }

        const model = this.buildModelInfo(rule);
        this.resolvedModelMap.set(alias, model);
        return model;
    }

    /** 检查别名是否存在 */
    hasAlias(alias: string): boolean {
        return this.aliasMap.has(alias);
    }

    /** 获取所有别名列表 */
    getAliases(): string[] {
        return Array.from(this.aliasMap.keys());
    }

    /** 校验路由规则。 */
    private validateRule(rule: RouterRule): void {
        const provider = this.providerMap.get(rule.provider);
        if (!provider) {
            throw new Error(
                `路由规则 "${rule.alias}" 无效：Provider "${rule.provider}" 未定义`
            );
        }

        if (!provider.models.includes(rule.model)) {
            throw new Error(
                `路由规则 "${rule.alias}" 无效：模型 "${rule.model}" 不在 Provider "${provider.name}" 的白名单中`
            );
        }
    }

    /** 由路由规则和 provider 构造 ModelInfo。 */
    private buildModelInfo(
        rule: RouterRule
    ): ModelInfo {
        const provider = this.providerMap.get(rule.provider);
        if (!provider) {
            throw new Error(
                `路由规则 "${rule.alias}" 无效：Provider "${rule.provider}" 未定义`
            );
        }

        const modelMetadata = this.modelMetadata[rule.model];
        const wellKnown = WELL_KNOWN_CONTEXT_WINDOWS[rule.model];
        const apiKey = expandApiKey(provider.apiKey, (message) => {
            console.warn(`Provider "${provider.name}" apiKey 配置无效：${message}`);
        });

        const contextWindow = typeof modelMetadata?.contextWindow === "number"
            ? modelMetadata.contextWindow
            : wellKnown?.contextWindow;
        const maxOutputTokens = typeof modelMetadata?.maxOutputTokens === "number"
            ? modelMetadata.maxOutputTokens
            : wellKnown?.maxOutputTokens;

        return {
            provider: provider.name,
            model: rule.model,
            type: provider.name === "anthropic" ? "anthropic" : "openai",
            alias: rule.alias,
            baseUrl: provider.baseUrl,
            apiKey,
            ...(typeof contextWindow === "number" ? {contextWindow} : {}),
            ...(typeof maxOutputTokens === "number" ? {maxOutputTokens} : {}),
            ...(modelMetadata?.thinking ? {thinking: modelMetadata.thinking} : {}),
            ...(modelMetadata?.effortLevel ? {effortLevel: modelMetadata.effortLevel} : {}),
        };
    }
}
