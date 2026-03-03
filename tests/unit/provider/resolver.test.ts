import {describe, expect, it, beforeEach, afterEach} from "bun:test";
import {ModelResolver, resolveApiKey} from "@core/provider";
import type {ModelRoutingConfig} from "@core/provider";

describe("resolveApiKey", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("应返回字面量密钥", () => {
    expect(resolveApiKey("sk-literal-key")).toBe("sk-literal-key");
  });

  it("应解析环境变量", () => {
    process.env.TEST_API_KEY = "sk-from-env";
    expect(resolveApiKey("$TEST_API_KEY")).toBe("sk-from-env");
  });

  it("环境变量未设置时应返回 undefined", () => {
    expect(resolveApiKey("$MISSING_VAR")).toBeUndefined();
  });

  it("空字符串应返回 undefined", () => {
    expect(resolveApiKey("")).toBeUndefined();
  });

  it("undefined 应返回 undefined", () => {
    expect(resolveApiKey(undefined)).toBeUndefined();
  });
});


describe("ModelResolver", () => {
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
    const resolver = new ModelResolver(mockConfig);
    const models = resolver.getAll();
    
    expect(models).toHaveLength(2);
    expect(models[0].displayName).toBe("sonnet");
    expect(models[1].displayName).toBe("opus");
  });

  it("应根据别名获取模型", () => {
    const resolver = new ModelResolver(mockConfig);
    
    const sonnet = resolver.getByAlias("sonnet");
    expect(sonnet).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4",
      type: "openai",
      displayName: "sonnet",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-openrouter-test",
    });

    const opus = resolver.getByAlias("opus");
    expect(opus.displayName).toBe("opus");
    expect(opus.provider).toBe("anthropic");
  });

  it("别名不存在时应抛出错误", () => {
    const resolver = new ModelResolver(mockConfig);
    expect(() => resolver.getByAlias("unknown")).toThrow(
      '❌ 别名 "unknown" 不存在'
    );
  });

  it("应检查别名是否存在", () => {
    const resolver = new ModelResolver(mockConfig);
    expect(resolver.hasAlias("sonnet")).toBe(true);
    expect(resolver.hasAlias("opus")).toBe(true);
    expect(resolver.hasAlias("unknown")).toBe(false);
  });

  it("应获取所有别名列表", () => {
    const resolver = new ModelResolver(mockConfig);
    const aliases = resolver.getAliases();
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

    expect(() => new ModelResolver(invalidConfig)).toThrow("Provider \"missing-provider\" 未定义");
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

    expect(() => new ModelResolver(invalidConfig)).toThrow("不在 Provider \"openrouter\" 的白名单中");
  });

});
