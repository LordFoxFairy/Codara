import {fromZodError} from "zod-validation-error";
import {ConfigSchema} from "@core/provider/config/schema";
import {resolveModelRoutingConfigPath} from "@core/provider/config/path";
import type {ModelRoutingConfig, RouterRule} from "@core/provider/model";

const toErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : "未知错误";

/** 解析单个路由规则（`provider:model`）。 */
function parseRouterRule(alias: string, target: string): RouterRule {
    const splitIndex = target.indexOf(":");
    if (splitIndex <= 0 || splitIndex === target.length - 1) {
        throw new Error(`router["${alias}"] 必须是 "provider:model" 格式`);
    }

    const provider = target.slice(0, splitIndex).trim();
    const model = target.slice(splitIndex + 1).trim();
    if (!provider || !model) {
        throw new Error(`router["${alias}"] 必须是 "provider:model" 格式`);
    }

    return {alias, provider, model, target};
}

/** 解析模型路由配置对象。 */
export function parseModelRoutingConfig(raw: unknown): ModelRoutingConfig {
    const result = ConfigSchema.safeParse(raw);
    if (!result.success) {
        throw new Error(fromZodError(result.error).message);
    }

    const {providers, router} = result.data;

    const routerRules = Object.entries(router).map(([alias, target]) =>
        parseRouterRule(alias, target)
    );

    return {providers, routerRules};
}

/** 加载并解析配置文件。 */
export async function loadModelRoutingConfig(): Promise<ModelRoutingConfig> {
    const configPath = resolveModelRoutingConfigPath();

    try {
        const data = await Bun.file(configPath).json();
        return parseModelRoutingConfig(data);
    } catch (error) {
        throw new Error(`加载配置失败（${configPath}）：${toErrorMessage(error)}`);
    }
}
