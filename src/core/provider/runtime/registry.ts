import type {ModelInfo, ModelRoutingConfig, ProviderConfig, RouterRule} from "@core/provider/model";
import {expandApiKey} from "@core/provider/runtime/api-key";

/**
 * 模型注册表
 * 负责解析配置并提供模型查询接口
 */
export class ModelRegistry {
    private readonly models: ModelInfo[];
    private readonly modelMap: Map<string, ModelInfo>;

    constructor(config: ModelRoutingConfig) {
        const providerMap = new Map(config.providers.map((p) => [p.name, p]));
        const aliasSet = new Set<string>();

        // 解析所有路由规则，配置错误直接 fail-fast
        this.models = config.routerRules.map((rule) => {
            if (aliasSet.has(rule.alias)) {
                throw new Error(`路由规则 "${rule.alias}" 重复定义`);
            }
            aliasSet.add(rule.alias);
            return this.validateAndBuildModel(rule, providerMap);
        });

        // 构建别名索引
        this.modelMap = new Map(this.models.map((m) => [m.alias, m]));
    }

    /** 获取所有模型 */
    getAll(): ModelInfo[] {
        return [...this.models];
    }

    /** 根据别名获取模型 */
    getByAlias(alias: string): ModelInfo {
        const model = this.modelMap.get(alias);
        if (!model) {
            throw new Error(`❌ 别名 "${alias}" 不存在`);
        }
        return model;
    }

    /** 检查别名是否存在 */
    hasAlias(alias: string): boolean {
        return this.modelMap.has(alias);
    }

    /** 获取所有别名列表 */
    getAliases(): string[] {
        return Array.from(this.modelMap.keys());
    }

    /**
     * 验证并构建模型信息
     * @param rule 路由规则
     * @param providerMap Provider 映射表
     * @returns 模型信息
     */
    private validateAndBuildModel(
        rule: RouterRule,
        providerMap: Map<string, ProviderConfig>
    ): ModelInfo {
        const provider = providerMap.get(rule.provider);
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

        return this.buildModelInfo(rule, provider);
    }

    /**
     * 构建模型信息对象
     * @param rule 路由规则
     * @param provider Provider 配置
     */
    private buildModelInfo(rule: RouterRule, provider: ProviderConfig): ModelInfo {
        return {
            provider: provider.name,
            model: rule.model,
            type: provider.name === "anthropic" ? "anthropic" : "openai",
            alias: rule.alias,
            baseUrl: provider.baseUrl,
            apiKey: expandApiKey(provider.apiKey),
        };
    }
}
