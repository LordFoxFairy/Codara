/**
 * 展开 apiKey 的环境变量引用（`$ENV_NAME`）。
 */
export const expandApiKey = (
    apiKey?: string,
    onWarning?: (message: string) => void
): string | undefined => {
    if (!apiKey) {
        return undefined;
    }

    if (!apiKey.startsWith("$")) {
        return apiKey;
    }

    const envName = apiKey.slice(1).trim();
    if (!envName) {
        onWarning?.("apiKey 环境变量名为空，已跳过");
        return undefined;
    }

    const envValue = process.env[envName];
    if (envValue === undefined) {
        return undefined;
    }

    if (!envValue.trim()) {
        onWarning?.(`环境变量 "${envName}" 为空字符串，已跳过`);
        return undefined;
    }

    return envValue;
};
