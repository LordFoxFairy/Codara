import {describe, expect, it, beforeEach, afterEach} from "bun:test";
import {ModelRegistry} from "@core/provider";
import type {ModelRoutingConfig} from "@core/provider";

describe("ModelRegistry", () => {
  const mockConfig: ModelRoutingConfig = {
    providers: [
      {
        name: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "$OPENROUTER_API_KEY",
        models: ["anthropic/claude-sonnet-4", "openai/gpt-4o"],
      },
      {
        name: "anthropic",
        apiKey: "$ANTHROPIC_API_KEY",
        models: ["claude-opus-4"],
      },
    ],
    routerRules: [
      {
        alias: "sonnet",
        provider: "openrouter",
        model: "anthropic/claude-sonnet-4",
        target: "openrouter:anthropic/claude-sonnet-4",
      },
      {
        alias: "opus",
        provider: "anthropic",
        model: "claude-opus-4",
        target: "anthropic:claude-opus-4",
      },
    ],
  };

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OPENROUTER_API_KEY = "sk-openrouter-test";
    process.env.ANTHROPIC_API_KEY = "sk-anthropic-test";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("应正确初始化并解析所有模型", () => {
    const registry = new ModelRegistry(mockConfig);
    const models = registry.getAll();

    expect(models).toHaveLength(2);
    expect(models[0].alias).toBe("sonnet");
    expect(models[1].alias).toBe("opus");
  });

  it("应根据别名获取模型", () => {
    const registry = new ModelRegistry(mockConfig);

    const sonnet = registry.getByAlias("sonnet");
    expect(sonnet).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4",
      type: "openai",
      alias: "sonnet",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-openrouter-test",
    });

    const opus = registry.getByAlias("opus");
    expect(opus.alias).toBe("opus");
    expect(opus.provider).toBe("anthropic");
  });

  it("别名不存在时应抛出错误", () => {
    const registry = new ModelRegistry(mockConfig);
    expect(() => registry.getByAlias("unknown")).toThrow(
      '❌ 别名 "unknown" 不存在'
    );
  });

  it("应检查别名是否存在", () => {
    const registry = new ModelRegistry(mockConfig);
    expect(registry.hasAlias("sonnet")).toBe(true);
    expect(registry.hasAlias("opus")).toBe(true);
    expect(registry.hasAlias("unknown")).toBe(false);
  });

  it("应获取所有别名列表", () => {
    const registry = new ModelRegistry(mockConfig);
    const aliases = registry.getAliases();
    expect(aliases).toEqual(["sonnet", "opus"]);
  });

  it("provider 不存在时应 fail-fast", () => {
    const invalidConfig: ModelRoutingConfig = {
      providers: [
        {
          name: "openrouter",
          models: ["anthropic/claude-sonnet-4"],
        },
      ],
      routerRules: [
        {
          alias: "sonnet",
          provider: "missing-provider",
          model: "anthropic/claude-sonnet-4",
          target: "missing-provider:anthropic/claude-sonnet-4",
        },
      ],
    };

    expect(() => new ModelRegistry(invalidConfig)).toThrow("Provider \"missing-provider\" 未定义");
  });

  it("模型不在 provider 白名单时应 fail-fast", () => {
    const invalidConfig: ModelRoutingConfig = {
      providers: [
        {
          name: "openrouter",
          models: ["anthropic/claude-sonnet-4"],
        },
      ],
      routerRules: [
        {
          alias: "opus",
          provider: "openrouter",
          model: "anthropic/claude-opus-4",
          target: "openrouter:anthropic/claude-opus-4",
        },
      ],
    };

    expect(() => new ModelRegistry(invalidConfig)).toThrow("不在 Provider \"openrouter\" 的白名单中");
  });

  it("重复 alias 时应 fail-fast", () => {
    const invalidConfig: ModelRoutingConfig = {
      providers: [
        {
          name: "openrouter",
          models: ["anthropic/claude-sonnet-4", "openai/gpt-4o"],
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
          alias: "default",
          provider: "openrouter",
          model: "openai/gpt-4o",
          target: "openrouter:openai/gpt-4o",
        },
      ],
    };

    expect(() => new ModelRegistry(invalidConfig)).toThrow('路由规则 "default" 重复定义');
  });

});
