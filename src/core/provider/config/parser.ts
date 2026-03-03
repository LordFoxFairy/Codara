import {fromZodError} from "zod-validation-error";
import {ConfigSchema} from "@core/provider/config/schema";
import type {ModelRoutingConfig, RouterRule} from "@core/provider/model";

/**
 * 解析单个路由规则
 * @param alias 别名
 * @param target 目标字符串（格式：provider:model）
 */
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

/**
 * 解析模型路由配置
 * @param raw 原始配置对象
 * @returns 解析后的配置
 */
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
