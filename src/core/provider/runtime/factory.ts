import {initChatModel} from "langchain/chat_models/universal";
import type {BaseChatModel} from "@langchain/core/language_models/chat_models";
import {ModelRegistry} from "@core/provider/runtime/registry";

/**
 * 初始化参数（可选）。
 * 未提供的字段由 LangChain 使用其内置默认值。
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

/**
 * 聊天模型工厂
 * 职责：根据别名创建 LangChain 模型实例
 */
export class ChatModelFactory {
    constructor(private readonly registry: ModelRegistry) {}

    /**
     * 创建模型实例（alias 必须已存在）。
     */
    create(alias: string): Promise<BaseChatModel> {
        const modelInfo = this.registry.getByAlias(alias);
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

        // LangChain ChatOpenAI 读取 configuration.baseURL，而不是顶层 baseUrl。
        // 这一步是 OpenAI 兼容提供方（如 DeepSeek/OpenRouter）生效的关键。
        if (modelInfo.type === "openai" && modelInfo.baseUrl) {
            const currentConfig =
                typeof initOptions.configuration === "object" && initOptions.configuration
                    ? (initOptions.configuration as Record<string, unknown>)
                    : ({} as Record<string, unknown>);
            initOptions.configuration = {
                ...currentConfig,
                baseURL: currentConfig.baseURL ?? modelInfo.baseUrl,
            };
        }

        return initOptions;
    }
}
