import {initChatModel} from "langchain/chat_models/universal";
import type {BaseChatModel} from "@langchain/core/language_models/chat_models";
import {ModelResolver} from "@core/provider/runtime/resolver";

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
 * 运行时模型管理器：
 * - 按 alias 解析模型
 * - 相同 alias 复用同一实例
 */
export class ChatModelManager {
    constructor(private readonly resolver: ModelResolver) {}

    /**
     * 获取模型实例（alias 必须已存在）。
     */
    get(alias: string): Promise<BaseChatModel> {
        const modelInfo = this.resolver.getByAlias(alias);
        const initOptions = this.buildInitOptions(modelInfo);
        return initChatModel(modelInfo.model, initOptions);
    }

    private buildInitOptions(
        modelInfo: ReturnType<ModelResolver["getByAlias"]>
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
