import {describe, expect, it} from "bun:test";
import {ChatModelFactory, loadModelRoutingConfig, ModelRegistry} from "@core/provider";

describe("DeepSeek End-to-End", () => {
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

    it("应能真实调用 hello", async () => {
        const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
        expect(Boolean(deepseekKey && !deepseekKey.startsWith("your-"))).toBe(true);

        const config = await loadModelRoutingConfig();
        const registry = new ModelRegistry(config);
        const factory = new ChatModelFactory(registry);
        const model = await factory.create("deepseek");
        const response = await model.invoke("hello");
        const text = typeof response.text === "string"
            ? response.text.trim()
            : String(response.content ?? "").trim();

        console.log("deepseek hello text:", text);
        expect(text.length).toBeGreaterThan(0);
    }, 120_000);
});
