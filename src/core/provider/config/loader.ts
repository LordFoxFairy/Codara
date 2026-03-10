import {fromZodError} from "zod-validation-error";
import {ConfigSchema, ModelMetadataConfigSchema} from "@core/provider/config/schema";
import {
    resolveModelMetadataConfigPath,
    resolveModelRoutingConfigPath,
} from "@core/provider/config/path";
import type {ModelMetadataConfig, ModelRoutingConfig, RouterRule} from "@core/provider/model";

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
export function parseModelRoutingConfig(
    raw: unknown,
    rawMetadata: unknown = {}
): ModelRoutingConfig {
    const result = ConfigSchema.safeParse(raw);
    if (!result.success) {
        throw new Error(fromZodError(result.error).message);
    }

    const metadataResult = ModelMetadataConfigSchema.safeParse(rawMetadata);
    if (!metadataResult.success) {
        throw new Error(fromZodError(metadataResult.error).message);
    }

    const {providers, router} = result.data;
    const modelMetadata = metadataResult.data as Record<string, ModelMetadataConfig>;

    const routerRules = Object.entries(router).map(([alias, target]) =>
        parseRouterRule(alias, target)
    );

    return {providers, routerRules, modelMetadata};
}

/** 加载并解析配置文件。 */
export async function loadModelRoutingConfig(): Promise<ModelRoutingConfig> {
    const configPath = resolveModelRoutingConfigPath();
    const metadataPath = resolveModelMetadataConfigPath();

    try {
        const [data, metadata] = await Promise.all([
            Bun.file(configPath).json(),
            loadModelMetadataConfig(metadataPath),
        ]);
        return parseModelRoutingConfig(data, metadata);
    } catch (error) {
        throw new Error(`加载配置失败（${configPath}）：${toErrorMessage(error)}`);
    }
}

async function loadModelMetadataConfig(metadataPath: string): Promise<unknown> {
    const file = Bun.file(metadataPath);
    if (!(await file.exists())) {
        return {};
    }
    return file.json();
}
