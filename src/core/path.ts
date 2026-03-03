function trimTrailingSlash(path: string): string {
    return path.replace(/\/+$/, "");
}

/**
 * Codara 配置根目录固定为 `~/.codara`。
 */
export function resolveCodaraPath(): string {
    const runtimeProcess = (
        globalThis as { process?: { env?: Record<string, string | undefined> } }
    ).process;
    const home = runtimeProcess?.env?.HOME?.trim();
    if (!home) {
        throw new Error("HOME 未设置，无法解析 ~/.codara 路径");
    }

    return `${trimTrailingSlash(home)}/.codara`;
}

/**
 * 解析模型路由配置文件路径。
 */
export function resolveModelRoutingConfigPath(): string {
    return `${resolveCodaraPath()}/config.json`;
}
