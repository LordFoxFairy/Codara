import {resolveModelRoutingConfigPath} from "@core/provider/config/path";
import type {ModelRoutingConfig} from "@core/provider/model";
import {parseModelRoutingConfig} from "@core/provider/config/parser";

const toErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : "未知错误";

/**
 * 加载模型路由配置文件
 * @returns 解析后的配置
 */
export async function loadModelRoutingConfig(): Promise<ModelRoutingConfig> {
    const configPath = resolveModelRoutingConfigPath();

    try {
        const data = await Bun.file(configPath).json();
        return parseModelRoutingConfig(data);
    } catch (error) {
        throw new Error(`加载配置失败（${configPath}）：${toErrorMessage(error)}`);
    }
}
