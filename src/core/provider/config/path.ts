import {homedir} from "os";

/** 移除路径末尾斜杠。 */
const trimTrailingSlash = (path: string): string => path.replace(/\/+$/, "");

/** 自定义配置目录环境变量。 */
const CODARA_PATH_ENV = "CODARA_PATH";

/**
 * 解析配置根目录。
 * 默认 `~/.codara`，可由 `CODARA_PATH` 覆盖。
 */
export const resolveCodaraPath = (): string => {
    const customPath = process.env[CODARA_PATH_ENV]?.trim();
    if (customPath) {
        return trimTrailingSlash(customPath);
    }

    const home =
        process.env.HOME?.trim() ||
        process.env.USERPROFILE?.trim() ||
        homedir().trim();
    if (!home) {
        throw new Error("无法获取用户主目录");
    }
    return `${trimTrailingSlash(home)}/.codara`;
};

/** 解析模型路由配置文件路径。 */
export const resolveModelRoutingConfigPath = (): string =>
    `${resolveCodaraPath()}/config.json`;
