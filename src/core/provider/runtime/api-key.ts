/**
 * 展开 apiKey 的环境变量引用（`$ENV_NAME`）。
 */
export const expandApiKey = (apiKey?: string): string | undefined => {
    if (!apiKey) {
        return undefined;
    }

    if (!apiKey.startsWith("$")) {
        return apiKey;
    }

    const envName = apiKey.slice(1).trim();
    if (!envName) {
        throw new Error("apiKey 环境变量名不能为空");
    }

    const envValue = process.env[envName];
    if (envValue === undefined) {
        return undefined;
    }

    if (!envValue.trim()) {
        throw new Error(`环境变量 "${envName}" 不能为空字符串`);
    }

    return envValue;
};
