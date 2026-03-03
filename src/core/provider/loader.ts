import {resolveModelRoutingConfigPath} from "../path";
import type {ModelRoutingConfig, ProviderConfig, RouterRule} from "./model";

/**
 * 验证并返回非空字符串。
 */
function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${field} 必须是非空字符串`);
    }
    return value.trim();
}

/**
 * 验证并返回对象。
 */
function requireObject(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${field} 必须是对象`);
    }
    return value as Record<string, unknown>;
}

/**
 * 解析 provider 配置。
 */
function parseProvider(raw: unknown, index: number): ProviderConfig {
    const obj = requireObject(raw, `providers[${index}]`);
    const prefix = `providers[${index}]`;

    // 解析必填字段
    const name = requireString(obj.name, `${prefix}.name`);

    // 解析可选字段
    const baseUrl = obj.baseUrl ? requireString(obj.baseUrl, `${prefix}.baseUrl`) : undefined;
    const apiKey = obj.apiKey ? requireString(obj.apiKey, `${prefix}.apiKey`) : undefined;

    // 解析 models 数组
    if (!Array.isArray(obj.models) || obj.models.length === 0) {
        throw new Error(`${prefix}.models 必须是非空数组`);
    }
    const models = obj.models.map((m, i) => requireString(m, `${prefix}.models[${i}]`));

    return {name, baseUrl, apiKey, models};
}

/**
 * 解析 router 规则。
 */
function parseRouterRule(alias: string, target: unknown): RouterRule {
    const targetStr = requireString(target, `router["${alias}"]`);
    const [provider, model] = targetStr.split(":");

    if (!provider?.trim() || !model?.trim()) {
        throw new Error(`router["${alias}"] 必须是 "provider:model" 格式`);
    }

    return {
        alias,
        provider: provider.trim(),
        model: model.trim(),
        target: targetStr,
    };
}

/**
 * 解析模型路由配置。
 */
export function parseModelRoutingConfig(raw: unknown): ModelRoutingConfig {
    const obj = requireObject(raw, "config");

    // 解析 providers
    if (!Array.isArray(obj.providers) || obj.providers.length === 0) {
        throw new Error("providers 必须是非空数组");
    }
    const providers = obj.providers.map((p, i) => parseProvider(p, i));

    // 解析 router
    const router = requireObject(obj.router, "router");
    const routerRules = Object.entries(router).map(([alias, target]) =>
        parseRouterRule(alias, target)
    );

    return {providers, routerRules};
}

/**
 * 加载模型路由配置。
 * @public 供外部模块使用
 */
export async function loadModelRoutingConfig(): Promise<ModelRoutingConfig> {
    const configPath = resolveModelRoutingConfigPath();

    // 读取文件
    let text: string;
    try {
        text = await Bun.file(configPath).text();
    } catch {
        throw new Error(`读取配置失败：${configPath}`);
    }

    // 解析 JSON
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        const msg = error instanceof Error ? error.message : "未知错误";
        throw new Error(`配置 JSON 非法（${configPath}）：${msg}`);
    }

    return parseModelRoutingConfig(parsed);
}
