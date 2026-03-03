import {describe, expect, it} from "bun:test";
import {ChatModelManager, ModelResolver} from "@core/provider";
import type {ModelRoutingConfig} from "@core/provider";

const baseConfig: ModelRoutingConfig = {
    providers: [
        {
            name: "openrouter",
            baseUrl: "https://openrouter.ai/api/v1",
            apiKey: "sk-test-openrouter",
            models: ["anthropic/claude-sonnet-4", "anthropic/claude-opus-4"],
        },
    ],
    routerRules: [
        {
            alias: "default",
            provider: "openrouter",
            model: "anthropic/claude-sonnet-4",
            target: "openrouter:anthropic/claude-sonnet-4",
        },
        {
            alias: "sonnet",
            provider: "openrouter",
            model: "anthropic/claude-sonnet-4",
            target: "openrouter:anthropic/claude-sonnet-4",
        },
    ],
};

describe("ChatModelManager", () => {
    it("同 alias 可重复创建模型实例", async () => {
        const resolver = new ModelResolver(baseConfig);
        const manager = new ChatModelManager(resolver);

        const a = await manager.get("default");
        const b = await manager.get("default");

        expect(typeof a.invoke).toBe("function");
        expect(typeof b.invoke).toBe("function");
    });

    it("openai 兼容 provider 应自动映射 configuration.baseURL", async () => {
        const resolver = new ModelResolver(baseConfig);
        const manager = new ChatModelManager(resolver);

        const model = await manager.get("default");
        const internal = model as unknown as {
            _defaultConfig?: {configuration?: {baseURL?: string}; modelProvider?: string};
        };

        expect(internal._defaultConfig?.modelProvider).toBe("openai");
        expect(internal._defaultConfig?.configuration?.baseURL).toBe(
            "https://openrouter.ai/api/v1"
        );
    });

    it("alias 不存在时应直接抛出错误", () => {
        const resolver = new ModelResolver(baseConfig);
        const manager = new ChatModelManager(resolver);

        expect(() => manager.get("unknown")).toThrow(
            '❌ 别名 "unknown" 不存在'
        );
    });
});
