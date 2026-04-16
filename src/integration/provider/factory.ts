import {initChatModel} from "langchain/chat_models/universal";
import type {BaseChatModel} from "@langchain/core/language_models/chat_models";
import type {EffortLevel, ThinkingConfig} from "@integration/provider/model";
import {ModelRegistry} from "@integration/provider/registry";

/**
 * initChatModel 的可选初始化参数。
 */
export interface ChatModelInitOptions {
    temperature?: number;
    maxTokens?: number;
    /** 超时时间（毫秒） */
    timeout?: number;
    maxRetries?: number;
    modelProvider?: string;
    apiKey?: string;
    baseUrl?: string;
    configuration?: Record<string, unknown>;
    anthropicApiUrl?: string;
    [key: string]: unknown;
}

/** Effort Level → thinking budget 映射。 */
const EFFORT_BUDGET: Record<EffortLevel, number> = {
    low: 2_000,
    medium: 10_000,
    high: 30_000,
};

/**
 * 解析最终的 ThinkingConfig：显式 thinking 优先，
 * 否则根据 effortLevel 自动映射（仅 Anthropic）。
 */
export function resolveThinkingConfig(
    thinking?: ThinkingConfig,
    effortLevel?: EffortLevel,
): ThinkingConfig | undefined {
    if (thinking) {
        return thinking;
    }
    if (effortLevel) {
        return {
            type: "enabled",
            budgetTokens: EFFORT_BUDGET[effortLevel],
        };
    }
    return undefined;
}

/** 按别名创建聊天模型。 */
export class ChatModelFactory {
    constructor(private readonly registry: ModelRegistry) {}

    /** 创建模型实例；alias 不存在时抛错。 */
    create(alias: string): Promise<BaseChatModel> {
        const modelInfo = this.registry.getByAlias(alias);
        if (!modelInfo.apiKey) {
            throw new Error(
                `No API key configured for model "${alias}" (provider: ${modelInfo.type}). ` +
                `Set the appropriate environment variable or configure it in .codara/model-metadata.json.`
            );
        }
        const initOptions = this.buildInitOptions(modelInfo);
        return initChatModel(modelInfo.model, initOptions);
    }

    private buildInitOptions(
        modelInfo: ReturnType<ModelRegistry["getByAlias"]>
    ): Record<string, unknown> {
        const initOptions: ChatModelInitOptions = {
            modelProvider: modelInfo.type,
        };

        if (modelInfo.apiKey) {
            initOptions.apiKey = modelInfo.apiKey;
        }

        // ChatOpenAI 使用 configuration.baseURL。
        if (modelInfo.type === "openai" && modelInfo.baseUrl) {
            const currentConfig = initOptions.configuration ?? {};
            initOptions.configuration = {
                ...currentConfig,
                baseURL: currentConfig.baseURL ?? modelInfo.baseUrl,
            };
        }

        // Anthropic Extended Thinking 支持。
        if (modelInfo.type === "anthropic") {
            const thinking = resolveThinkingConfig(modelInfo.thinking, modelInfo.effortLevel);
            if (thinking?.type === "enabled" && thinking.budgetTokens) {
                initOptions.thinking = {
                    type: "enabled",
                    budget_tokens: thinking.budgetTokens,
                };
            }

            // Anthropic Prompt Caching — 自动对最后一条消息启用缓存。
            initOptions.cache_control = {type: "ephemeral"};
        }

        return initOptions;
    }
}
