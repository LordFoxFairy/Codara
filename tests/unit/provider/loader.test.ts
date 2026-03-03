import {describe, expect, it, beforeEach, afterEach} from "bun:test";
import {loadModelRoutingConfig, parseModelRoutingConfig} from "../../../src/core/provider/loader";
import {writeFileSync, unlinkSync, mkdirSync} from "fs";
import {join} from "path";
import {homedir} from "os";

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
        expect(() => parseModelRoutingConfig(null)).toThrow("config 必须是对象");
        expect(() => parseModelRoutingConfig("string")).toThrow("config 必须是对象");
        expect(() => parseModelRoutingConfig([])).toThrow("config 必须是对象");
    });

    it("providers 为空数组时应抛出错误", () => {
        const raw = {
            providers: [],
            router: {},
        };
        expect(() => parseModelRoutingConfig(raw)).toThrow("providers 必须是非空数组");
    });

    it("provider.name 为空时应抛出错误", () => {
        const raw = {
            providers: [{name: "", models: ["model1"]}],
            router: {},
        };
        expect(() => parseModelRoutingConfig(raw)).toThrow("providers[0].name 必须是非空字符串");
    });

    it("provider.models 为空数组时应抛出错误", () => {
        const raw = {
            providers: [{name: "test", models: []}],
            router: {},
        };
        expect(() => parseModelRoutingConfig(raw)).toThrow("providers[0].models 必须是非空数组");
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
});

describe("loadModelRoutingConfig", () => {
    const testConfigPath = join(homedir(), ".codara", "config.json");
    const testConfig = {
        providers: [
            {
                name: "openai",
                models: ["gpt-4o"],
            },
        ],
        router: {
            default: "openai:gpt-4o",
        },
    };

    beforeEach(() => {
        // 确保目录存在
        mkdirSync(join(homedir(), ".codara"), {recursive: true});
        // 写入测试配置
        writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));
    });

    afterEach(() => {
        // 清理测试文件
        try {
            unlinkSync(testConfigPath);
        } catch {
            // 忽略错误
        }
    });

    it("应成功加载配置文件", async () => {
        const config = await loadModelRoutingConfig();
        expect(config.providers).toHaveLength(1);
        expect(config.providers[0].name).toBe("openai");
        expect(config.routerRules).toHaveLength(1);
    });

    it("配置文件不存在时应抛出错误", async () => {
        unlinkSync(testConfigPath);
        await expect(loadModelRoutingConfig()).rejects.toThrow("读取配置失败");
    });

    it("配置文件 JSON 格式错误时应抛出错误", async () => {
        writeFileSync(testConfigPath, "invalid json");
        await expect(loadModelRoutingConfig()).rejects.toThrow("配置 JSON 非法");
    });
});
