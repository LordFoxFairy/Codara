/**
 * 移除路径末尾的斜杠
 */
const trimTrailingSlash = (path: string): string => path.replace(/\/+$/, "");

/**
 * 可选环境变量：自定义 Codara 配置目录
 */
const CODARA_PATH_ENV = "CODARA_PATH";

/**
 * Codara 配置根目录
 * 默认是 `~/.codara`，可通过 `CODARA_PATH` 覆盖
 */
export const resolveCodaraPath = (): string => {
    const customPath = process.env[CODARA_PATH_ENV]?.trim();
    if (customPath) {
        return trimTrailingSlash(customPath);
    }

    const home = process.env.HOME?.trim();
    if (!home) {
        throw new Error("无法获取用户主目录");
    }
    return `${trimTrailingSlash(home)}/.codara`;
};

/**
 * 解析模型路由配置文件路径
 * @returns ~/.codara/config.json
 */
export const resolveModelRoutingConfigPath = (): string =>
    `${resolveCodaraPath()}/config.json`;
