/**
 * 解析 API 密钥，支持 $ENV_VAR 语法。
 */
export function resolveApiKey(apiKey?: string): string | undefined {
    if (!apiKey) return undefined;
    return apiKey.startsWith("$") ? process.env[apiKey.slice(1)] : apiKey;
}
