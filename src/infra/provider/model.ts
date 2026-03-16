/**
 * 内置 well-known 模型默认 contextWindow / maxOutputTokens。
 * 当用户配置中未提供 modelMetadata 时，使用此表作为 fallback。
 * 键为模型 ID（不区分 provider）。
 */
export const WELL_KNOWN_CONTEXT_WINDOWS: Record<string, {contextWindow: number; maxOutputTokens?: number}> = {
  // Anthropic
  'claude-opus-4-20250514': {contextWindow: 200_000, maxOutputTokens: 32_000},
  'claude-sonnet-4-20250514': {contextWindow: 200_000, maxOutputTokens: 16_000},
  'claude-3-5-haiku-20241022': {contextWindow: 200_000, maxOutputTokens: 8_192},
  'claude-3-7-sonnet-20250219': {contextWindow: 200_000, maxOutputTokens: 64_000},
  'claude-sonnet-4-0': {contextWindow: 200_000, maxOutputTokens: 16_000},
  'claude-opus-4-0': {contextWindow: 200_000, maxOutputTokens: 32_000},
  // OpenAI
  'gpt-4o': {contextWindow: 128_000, maxOutputTokens: 16_384},
  'gpt-4o-mini': {contextWindow: 128_000, maxOutputTokens: 16_384},
  'gpt-4-turbo': {contextWindow: 128_000, maxOutputTokens: 4_096},
  'o1': {contextWindow: 200_000, maxOutputTokens: 100_000},
  'o1-mini': {contextWindow: 128_000, maxOutputTokens: 65_536},
  'o3': {contextWindow: 200_000, maxOutputTokens: 100_000},
  'o3-mini': {contextWindow: 200_000, maxOutputTokens: 100_000},
  'o4-mini': {contextWindow: 200_000, maxOutputTokens: 100_000},
  // DeepSeek
  'deepseek-chat': {contextWindow: 64_000, maxOutputTokens: 8_192},
  'deepseek-reasoner': {contextWindow: 64_000, maxOutputTokens: 8_192},
  // Google
  'gemini-2.5-pro': {contextWindow: 1_000_000, maxOutputTokens: 65_536},
  'gemini-2.5-flash': {contextWindow: 1_000_000, maxOutputTokens: 65_536},
};

export interface ModelMetadataConfig {
    contextWindow?: number;
    maxOutputTokens?: number;
}

/**
 * 配置中的单个 Provider 定义。
 */
export interface ProviderConfig {
    /** Provider 名称，例如 "openrouter"。 */
    name: string;
    /** 可选的 OpenAI 兼容端点。 */
    baseUrl?: string;
    /** 字面量密钥或环境变量引用，例如 "$OPENROUTER_API_KEY"。 */
    apiKey?: string;
    /** Provider 允许的模型 ID 列表。 */
    models: string[];
}

/**
 * 运行时路由使用的标准化规则。
 */
export interface RouterRule {
    /** 路由别名，例如 "sonnet"。 */
    alias: string;
    /** 从 "provider:model" 解析出的 provider。 */
    provider: string;
    /** 从 "provider:model" 解析出的 model。 */
    model: string;
    /** 原始目标字符串。 */
    target: string;
}

/**
 * 解析和标准化后的运行时路由结构。
 */
export interface ModelRoutingConfig {
    providers: ProviderConfig[];
    /** router 解析后的规则列表。 */
    routerRules: RouterRule[];
    /** 按模型 ID 聚合的可选元数据。 */
    modelMetadata: Record<string, ModelMetadataConfig>;
}

/**
 * 单个模型实例的运行时信息（解析后）。
 */
export interface ModelInfo {
    /** Provider 名称。 */
    provider: string;
    /** 模型 ID。 */
    model: string;
    /** 模型协议类型。 */
    type: "openai" | "anthropic";
    /** 路由别名。 */
    alias: string;
    /** API 端点。 */
    baseUrl?: string;
    /** API 密钥。 */
    apiKey?: string;
    /** 可选上下文窗口。 */
    contextWindow?: number;
    /** 可选最大输出 token。 */
    maxOutputTokens?: number;
}
