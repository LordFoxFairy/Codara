import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {fromZodError} from "zod-validation-error";
import {ConfigSchema, ModelMetadataConfigSchema} from "@integration/provider/schema";
import type {ModelMetadataConfig, ModelRoutingConfig, RouterRule} from "@integration/provider/model";

const CODARA_PATH_ENV = 'CODARA_PATH';

const toErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : "未知错误";

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

export function resolveCodaraPath(): string {
    const customPath = process.env[CODARA_PATH_ENV]?.trim();
    if (customPath) {
        return trimTrailingSlash(customPath);
    }

    const home =
        process.env.HOME?.trim()
        || process.env.USERPROFILE?.trim()
        || homedir().trim();
    if (!home) {
        throw new Error("无法获取用户主目录");
    }

    return `${trimTrailingSlash(home)}/.codara`;
}

export function resolveModelRoutingConfigPath(): string {
    return `${resolveCodaraPath()}/config.json`;
}

export function resolveModelMetadataConfigPath(): string {
    return `${resolveCodaraPath()}/model-metadata.json`;
}

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
    return loadModelRoutingConfigFromPath(resolveCodaraPath());
}

export async function loadModelRoutingConfigFromPath(codaraPath: string): Promise<ModelRoutingConfig> {
    const configPath = `${trimTrailingSlash(codaraPath)}/config.json`;
    const metadataPath = `${trimTrailingSlash(codaraPath)}/model-metadata.json`;

    try {
        const [data, metadata] = await Promise.all([
            readJsonFile(configPath),
            loadModelMetadataConfig(metadataPath),
        ]);
        return parseModelRoutingConfig(data, metadata);
    } catch (error) {
        throw new Error(`加载配置失败（${configPath}）：${toErrorMessage(error)}`);
    }
}

/** Read and parse a JSON file using Node.js fs (runtime-agnostic). */
async function readJsonFile(filePath: string): Promise<unknown> {
    const content = await readFile(filePath, 'utf8');
    return JSON.parse(content);
}

async function loadModelMetadataConfig(metadataPath: string): Promise<unknown> {
    if (!existsSync(metadataPath)) {
        return {};
    }
    return readJsonFile(metadataPath);
}
