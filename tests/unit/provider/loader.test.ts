import {describe, expect, it, beforeEach, afterEach} from "bun:test";
import {loadModelRoutingConfig} from "@core/provider";
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync} from "fs";
import {join} from "path";
import {tmpdir} from "os";

describe("loadModelRoutingConfig", () => {
    let originalHome: string | undefined;
    let originalCodaraPath: string | undefined;
    let testHome: string;
    let testConfigPath: string;

    const testConfig = {
        providers: [
            {
                name: "openai",
                models: [{id: "gpt-4o"}],
            },
        ],
        router: {
            default: "openai:gpt-4o",
        },
    };

    beforeEach(() => {
        originalHome = process.env.HOME;
        originalCodaraPath = process.env.CODARA_PATH;
        testHome = mkdtempSync(join(tmpdir(), "codara-home-"));
        process.env.HOME = testHome;
        delete process.env.CODARA_PATH;
        testConfigPath = join(testHome, ".codara", "config.json");

        // 确保目录存在
        mkdirSync(join(testHome, ".codara"), {recursive: true});
        // 写入测试配置
        writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));
    });

    afterEach(() => {
        process.env.HOME = originalHome;
        process.env.CODARA_PATH = originalCodaraPath;
        rmSync(testHome, {recursive: true, force: true});
    });

    it("应成功加载配置文件", async () => {
        const config = await loadModelRoutingConfig();
        expect(config.providers).toHaveLength(1);
        expect(config.providers[0].name).toBe("openai");
        expect(config.routerRules).toHaveLength(1);
    });

    it("配置文件不存在时应抛出错误", async () => {
        rmSync(testConfigPath, {force: true});
        await expect(loadModelRoutingConfig()).rejects.toThrow("加载配置失败");
    });

    it("配置文件 JSON 格式错误时应抛出错误", async () => {
        writeFileSync(testConfigPath, "invalid json");
        await expect(loadModelRoutingConfig()).rejects.toThrow("加载配置失败");
    });

    it("仓库默认配置应将 default alias 指向 sonnet 并提供上下文窗口元数据", () => {
        const repoConfig = JSON.parse(
            readFileSync(join(process.cwd(), ".codara", "config.json"), "utf8")
        ) as {
            providers: Array<{name: string; models: Array<{id: string; contextWindow?: number; maxOutputTokens?: number}>}>;
            router: Record<string, string>;
        };

        expect(repoConfig.router.default).toBe("openrouter:anthropic/claude-sonnet-4");
        expect(repoConfig.router.fast).toBe("openrouter:anthropic/claude-3.5-haiku");

        const sonnet = repoConfig.providers
            .flatMap((provider) => provider.models)
            .find((model) => model.id === "anthropic/claude-sonnet-4");

        expect(sonnet?.contextWindow).toBe(200000);
        expect(sonnet?.maxOutputTokens).toBe(8192);
    });
});
