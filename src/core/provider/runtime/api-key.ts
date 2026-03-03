/**
 * 解析 Provider API Key。
 * 支持字面量或环境变量引用（格式：$ENV_NAME）。
 */
export const resolveApiKey = (apiKey?: string): string | undefined => {
    if (!apiKey) {
        return undefined;
    }

    if (!apiKey.startsWith("$")) {
        return apiKey;
    }

    const envName = apiKey.slice(1).trim();
    if (!envName) {
        return undefined;
    }

    const envValue = process.env[envName];
    return envValue || undefined;
};
