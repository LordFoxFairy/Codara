import {initChatModel} from "langchain/chat_models/universal";
import type {BaseChatModel} from "@langchain/core/language_models/chat_models";
import {ModelRegistry} from "@core/provider/runtime/registry";

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

/** 按别名创建聊天模型。 */
export class ChatModelFactory {
    constructor(private readonly registry: ModelRegistry) {}

    /** 创建模型实例；alias 不存在时抛错。 */
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

        // ChatOpenAI 使用 configuration.baseURL。
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
