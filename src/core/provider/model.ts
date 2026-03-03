/**
 * 配置中的单个 Provider 定义。
 */
export interface ProviderConfig {
    /** Provider 唯一名称，例如 "openrouter" */
    name: string;
    /** 可选的 OpenAI 兼容端点 */
    baseUrl?: string;
    /** 字面量密钥或环境变量引用，例如 "$OPENROUTER_API_KEY" */
    apiKey?: string;
    /** 该 Provider 允许的模型 ID 列表 */
    models: string[];
}

/**
 * 运行时路由使用的标准化规则。
 */
export interface RouterRule {
    /** 路由别名，例如 "sonnet" */
    alias: string;
    /** 从 "provider:model" 解析出的 provider */
    provider: string;
    /** 从 "provider:model" 解析出的 model */
    model: string;
    /** 原始目标字符串，例如 "openrouter:anthropic/claude-sonnet-4" */
    target: string;
}

/**
 * 解析和标准化后的运行时路由结构。
 */
export interface ModelRoutingConfig {
    providers: ProviderConfig[];
    /** 由原始 router 映射解析得到的规则列表 */
    routerRules: RouterRule[];
}

/**
 * 单个模型实例的运行时信息（解析后）。
 */
export interface ModelInfo {
    /** Provider 名称 */
    provider: string;
    /** 模型 ID */
    model: string;
    /** 模型协议类型（用于初始化与参数映射） */
    type: "openai" | "anthropic";
    /** 路由别名（用户使用的别名，如 "sonnet"） */
    alias: string;
    /** API 端点（已从 ProviderConfig 继承） */
    baseUrl?: string;
    /** API 密钥（已解析环境变量） */
    apiKey?: string;
}
