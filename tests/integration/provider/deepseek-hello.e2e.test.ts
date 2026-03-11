import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import path from "node:path";
import {ChatModelFactory, loadModelRoutingConfig, ModelRegistry, parseModelRoutingConfig} from "@core/provider";
import {createMockRoutingConfig, startMockOpenAIServer} from "./mock-openai-server";

describe("DeepSeek End-to-End", () => {
    const cleanups: Array<() => void> = [];
    let originalCodaraPath: string | undefined;

    beforeEach(() => {
        originalCodaraPath = process.env.CODARA_PATH;
        process.env.CODARA_PATH = path.join(process.cwd(), ".codara");
    });

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }

        if (originalCodaraPath === undefined) {
            delete process.env.CODARA_PATH;
            return;
        }

        process.env.CODARA_PATH = originalCodaraPath;
    });

    it("应正常加载配置并解析 deepseek 路由", async () => {
        const config = await loadModelRoutingConfig();
        const registry = new ModelRegistry(config);

        expect(registry.hasAlias("deepseek")).toBe(true);
        expect(registry.getByAlias("deepseek").model.length).toBeGreaterThan(0);
    });

    it("应能加载 deepseek 模型实例", async () => {
        const config = await loadModelRoutingConfig();
        const registry = new ModelRegistry(config);
        const factory = new ChatModelFactory(registry);
        const model = await factory.create("deepseek");

        expect(typeof model.invoke).toBe("function");
    });

    it("应能通过本地 openai 兼容 provider 完成一次真实 invoke", async () => {
        const server = startMockOpenAIServer([{content: "hello from mock provider"}]);
        cleanups.push(() => server.stop());

        const config = parseModelRoutingConfig(createMockRoutingConfig(server.baseUrl));
        const registry = new ModelRegistry(config);
        const factory = new ChatModelFactory(registry);
        const model = await factory.create("mock");
        const response = await model.invoke("hello");

        const text = String(response.content ?? "").trim();
        expect(text.length).toBeGreaterThan(0);
        expect(text).toContain("hello from mock provider");
        expect(server.requests).toHaveLength(1);
    });
});
