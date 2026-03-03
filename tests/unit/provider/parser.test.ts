import {describe, expect, it} from "bun:test";
import {parseModelRoutingConfig} from "@core/provider";

describe("parseModelRoutingConfig", () => {
    it("应正确解析有效配置", () => {
        const raw = {
            providers: [
                {
                    name: "openai",
                    baseUrl: "https://api.openai.com/v1",
                    apiKey: "$OPENAI_API_KEY",
                    models: ["gpt-4o", "gpt-3.5-turbo"],
                },
            ],
            router: {
                default: "openai:gpt-4o",
            },
        };

        const config = parseModelRoutingConfig(raw);

        expect(config.providers).toHaveLength(1);
        expect(config.providers[0].name).toBe("openai");
        expect(config.routerRules).toHaveLength(1);
        expect(config.routerRules[0].alias).toBe("default");
        expect(config.routerRules[0].provider).toBe("openai");
        expect(config.routerRules[0].model).toBe("gpt-4o");
    });

    it("配置不是对象时应抛出错误", () => {
        expect(() => parseModelRoutingConfig(null)).toThrow("expected object");
        expect(() => parseModelRoutingConfig("string")).toThrow("expected object");
        expect(() => parseModelRoutingConfig([])).toThrow("expected object");
    });

    it("providers 为空数组时应抛出错误", () => {
        const raw = {
            providers: [],
            router: {},
        };
        expect(() => parseModelRoutingConfig(raw)).toThrow("expected array to have >=1 items");
    });

    it("provider.name 为空时应抛出错误", () => {
        const raw = {
            providers: [{name: "", models: ["model1"]}],
            router: {},
        };
        expect(() => parseModelRoutingConfig(raw)).toThrow("expected string to have >=1 characters");
    });

    it("provider.models 为空数组时应抛出错误", () => {
        const raw = {
            providers: [{name: "test", models: []}],
            router: {},
        };
        expect(() => parseModelRoutingConfig(raw)).toThrow("expected array to have >=1 items");
    });

    it("router 格式错误时应抛出错误", () => {
        const raw = {
            providers: [{name: "test", models: ["model1"]}],
            router: {
                alias1: "invalid-format",
            },
        };
        expect(() => parseModelRoutingConfig(raw)).toThrow('router["alias1"] 必须是 "provider:model" 格式');
    });

    it("router 规则应自动 trim provider 和 model", () => {
        const raw = {
            providers: [{name: "openai", models: ["gpt-4o"]}],
            router: {
                default: "  openai : gpt-4o  ",
            },
        };

        const config = parseModelRoutingConfig(raw);
        expect(config.routerRules[0].provider).toBe("openai");
        expect(config.routerRules[0].model).toBe("gpt-4o");
    });

    it("router model 允许包含附加冒号", () => {
        const raw = {
            providers: [{name: "openrouter", models: ["anthropic/claude-sonnet-4:beta"]}],
            router: {
                sonnet: "openrouter:anthropic/claude-sonnet-4:beta",
            },
        };

        const config = parseModelRoutingConfig(raw);
        expect(config.routerRules[0].provider).toBe("openrouter");
        expect(config.routerRules[0].model).toBe("anthropic/claude-sonnet-4:beta");
    });
});

