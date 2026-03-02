# 模型路由 — 提供商抽象与模型创建

> [← 上一篇: 代理循环](./02-agent-loop.md) | [目录](./README.md) | [下一篇: 工具 →](./03-tools.md)

> 所有模型解析都通过路由器完成。代码库中没有任何硬编码的模型 ID。

本文档介绍 Codara 如何解析模型别名、选择提供商以及构建 LangChain 模型实例。路由器是将用户可见的模型名称映射到实际 API 端点的唯一事实来源。

## 在主线中的定位

模型路由属于核心运行时基础设施：
- 解决“调用哪个模型”的机制问题；
- 不承载项目策略（安全检查、审计、权限流程等）。

策略类需求应通过 hooks + skills 编排，而不是在路由层做场景特判。

---

## 目录

1. [设计原则](#1-设计原则)
2. [配置 (config.json)](#2-配置)
3. [解析流程](#3-解析流程)
4. [模型构建](#4-模型构建)
5. [工具绑定](#5-工具绑定)
6. [子代理模型继承](#6-子代理模型继承)
7. [常见配置](#7-常见配置)

---

## 1. 设计原则

**路由器是唯一将模型名称映射到提供商的地方。** 应用程序中的任何代码路径都不应包含硬编码的模型 ID。所有代码都使用 `"sonnet"`、`"opus"` 或 `"default"` 等别名，路由器在运行时将它们解析为实际的提供商和模型 ID。

为什么这很重要：

- **提供商无关性。** 用户可能使用 OpenRouter、原生 Anthropic、原生 OpenAI 或任何 OpenAI 兼容端点。路由器将此抽象化。
- **单点修改。** 从 OpenRouter 切换到直连 Anthropic 只需编辑一个配置文件。
- **子代理一致性。** 子代理继承或覆盖模型时，使用相同的解析管道，没有特殊情况。

---

## 2. 配置

模型路由在 `.codara/config.json` 中配置。系统按以下顺序检查两个位置：

1. `<project-dir>/.codara/config.json`（项目级别，优先级更高）
2. `~/.codara/config.json`（用户全局）

第一个同时包含 `providers` 和 `router` 键的文件生效。

### ProviderConfig 结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 唯一标识符，如 `"openrouter"`、`"anthropic"`、`"openai"` |
| `baseUrl` | string | 否 | OpenAI 兼容端点；使用原生 SDK 时省略 |
| `apiKey` | string | 否 | 字面量密钥或 `"$ENV_VAR"` 用于环境变量展开 |
| `models` | string[] | 是 | 可用模型 ID 列表 |

### ModelRouterConfig 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `providers` | ProviderConfig[] | 提供商列表 |
| `router` | Record<别名, "provider:model"> | 别名到 `"provider:model"` 的映射 |

### apiKey 环境变量语法

`apiKey` 字段支持 `$ENV_VAR` 语法。当值以 `$` 开头时，系统在运行时读取对应的环境变量：

```json
"apiKey": "$OPENROUTER_API_KEY"
```

如果该变量未设置，密钥解析为 `undefined`。

### 示例：OpenRouter 代理

```json
{
  "providers": [
    {
      "name": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "$OPENROUTER_API_KEY",
      "models": [
        "anthropic/claude-opus-4",
        "anthropic/claude-sonnet-4",
        "anthropic/claude-3.5-haiku"
      ]
    }
  ],
  "router": {
    "opus": "openrouter:anthropic/claude-opus-4",
    "sonnet": "openrouter:anthropic/claude-sonnet-4",
    "haiku": "openrouter:anthropic/claude-3.5-haiku",
    "default": "openrouter:anthropic/claude-sonnet-4"
  }
}
```

使用此配置：
- `--model sonnet` 解析为 OpenRouter 的 `anthropic/claude-sonnet-4`
- `--model opus` 解析为 OpenRouter 的 `anthropic/claude-opus-4`
- 省略 `--model` 时使用 `"default"`，映射到 Sonnet

---

## 3. 解析流程

`resolveModel(input, router)` 接收模型别名字符串，返回包含提供商名称、模型 ID、显示名称、基础 URL 和 API 密钥的解析结果。

### ResolvedModel 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `providerName` | string | 提供商标识 |
| `modelId` | string | 完整模型 ID |
| `displayName` | string | 用于显示的友好名称 |
| `baseUrl` | string? | OpenAI 兼容端点（如有） |
| `apiKey` | string? | 已解析的 API 密钥 |

### 逐步流程

```
输入别名（如 "sonnet"）
     │
     ▼
┌─────────────────────────────┐
│ 1. 路由器别名查找            │  router.router["sonnet"] → "openrouter:anthropic/claude-sonnet-4"
│    找到？→ 展开              │
│    未找到？→ 继续            │
└─────────────────────────────┘
     │
     ▼
┌─────────────────────────────┐
│ 2. "default" 特殊情况       │  如果输入是 "default" 且不在路由映射中：
│    使用第一个提供商的        │  → providers[0].name + ":" + providers[0].models[0]
│    第一个模型               │
└─────────────────────────────┘
     │
     ▼
┌─────────────────────────────┐
│ 3. 分割 "provider:model"    │  "openrouter:anthropic/claude-sonnet-4"
│    provider = "openrouter"  │  → providerName = "openrouter"
│    model = "anthropic/..."  │  → modelId = "anthropic/claude-sonnet-4"
└─────────────────────────────┘
     │
     ▼
┌─────────────────────────────┐
│ 4. 无冒号？猜测提供商       │  "claude-sonnet-4" → "anthropic"
│    claude* → anthropic      │  "gpt-4o" → "openai"
│    gpt*/o1*/o3* → openai    │  "deepseek-*" → "deepseek"
│    其他 → openai（默认）    │
└─────────────────────────────┘
     │
     ▼
┌─────────────────────────────┐
│ 5. 提供商查找               │  在 providers[] 中按名称查找提供商
│    → baseUrl, apiKey        │  解析环境变量
└─────────────────────────────┘
     │
     ▼
  ResolvedModel
```

### "default" 回退机制

当未提供 `--model` 参数时，模型设置为 `"default"`。解析过程随后检查：

1. `"default"` 是否在路由器中有映射？如果是，使用该映射。
2. 如果没有，取 `providers[0].name:providers[0].models[0]` 作为回退。
3. 如果完全没有配置提供商，原始字符串直接传递，模型创建时可能会失败。

---

## 4. 模型构建

`createModel(config, tools)` 调用 `resolveModel()`，然后根据解析后的提供商构建相应的 LangChain 模型实例。

### 决策树

| 条件 | 使用的 SDK | 说明 |
|---|---|---|
| `baseUrl` 已设置 | ChatOpenAI | OpenAI 兼容代理模式（OpenRouter、Ollama 等） |
| `providerName === "anthropic"` | ChatAnthropic | 原生 Anthropic SDK |
| 其他情况 | ChatOpenAI | 原生 OpenAI SDK |

### 构造参数

所有模型统一使用以下参数：

| 参数 | 值 | 说明 |
|------|-----|------|
| `temperature` | 0 | 确定性输出 |
| `topP` | 1 | 无核采样限制（避免代理端默认 -1 被 API 拒绝） |
| `maxTokens` | 16384 | 最大输出 token 数 |

### API 密钥验证

在构建模型之前，会验证 API 密钥是否可用：

- 有 `baseUrl` 的提供商：使用 `"sk-placeholder"` 作为回退（某些代理以不同方式处理认证）。
- 无 `baseUrl` 且配置中无密钥：检查标准环境变量（`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`DEEPSEEK_API_KEY` 或 `<PROVIDER_NAME>_API_KEY`）。
- 找不到密钥时：抛出明确的错误消息，告知用户需要设置哪个环境变量。

---

## 5. 工具绑定

模型构建完成后，通过 `model.bindTools(tools)` 绑定工具。工具是从 Codara 工具定义转换的 LangChain `StructuredTool` 实例。`bindTools()` 将函数调用模式附加到模型上，使 LLM 能够在响应中调用工具。

如果模型不支持工具使用（没有 `bindTools` 方法），会抛出明确的错误消息。

---

## 6. 子代理模型继承

子代理通过优先级链确定其模型：

```
options.model → customDef.model → builtin.model → parentConfig.model
```

| 来源 | 描述 |
|---|---|
| `options.model` | 生成子代理时显式传入 |
| `customDef.model` | 来自用户定义的子代理配置 |
| `builtin.model` | 来自内置子代理定义（如 Explore 代理使用 haiku） |
| `parentConfig.model` | 回退到父代理的模型 |

### "inherit" 关键字

将模型设置为 `"inherit"` 表示"使用与父代理完全相同的模型字符串"。所有其他值都通过 `resolveModel()` 传递，由路由器处理别名解析。子代理定义可以使用任何路由器别名。

---

## 7. 常见配置

### OpenRouter 代理（推荐用于多模型访问）

通过 OpenRouter 路由所有模型。一个 API 密钥，访问所有提供商。

```json
{
  "providers": [
    {
      "name": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "$OPENROUTER_API_KEY",
      "models": [
        "anthropic/claude-opus-4",
        "anthropic/claude-sonnet-4",
        "anthropic/claude-3.5-haiku"
      ]
    }
  ],
  "router": {
    "opus": "openrouter:anthropic/claude-opus-4",
    "sonnet": "openrouter:anthropic/claude-sonnet-4",
    "haiku": "openrouter:anthropic/claude-3.5-haiku",
    "default": "openrouter:anthropic/claude-sonnet-4"
  }
}
```

### 直连 Anthropic API

直接使用 Anthropic 的 API。无代理，原生 SDK。

```json
{
  "providers": [
    {
      "name": "anthropic",
      "apiKey": "$ANTHROPIC_API_KEY",
      "models": [
        "claude-opus-4-20250514",
        "claude-sonnet-4-20250514",
        "claude-haiku-3-5-20241022"
      ]
    }
  ],
  "router": {
    "opus": "anthropic:claude-opus-4-20250514",
    "sonnet": "anthropic:claude-sonnet-4-20250514",
    "haiku": "anthropic:claude-haiku-3-5-20241022",
    "default": "anthropic:claude-sonnet-4-20250514"
  }
}
```

注意：提供商上没有 `baseUrl`，因此系统使用原生 ChatAnthropic。

### 直连 OpenAI API

```json
{
  "providers": [
    {
      "name": "openai",
      "apiKey": "$OPENAI_API_KEY",
      "models": ["gpt-4o", "gpt-4o-mini", "o3-mini"]
    }
  ],
  "router": {
    "gpt4": "openai:gpt-4o",
    "mini": "openai:gpt-4o-mini",
    "o3": "openai:o3-mini",
    "default": "openai:gpt-4o"
  }
}
```

### 混合提供商

为不同的模型层级使用不同的提供商。

```json
{
  "providers": [
    {
      "name": "anthropic",
      "apiKey": "$ANTHROPIC_API_KEY",
      "models": ["claude-opus-4-20250514", "claude-sonnet-4-20250514"]
    },
    {
      "name": "ollama",
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "ollama",
      "models": ["llama3.1:70b"]
    }
  ],
  "router": {
    "opus": "anthropic:claude-opus-4-20250514",
    "sonnet": "anthropic:claude-sonnet-4-20250514",
    "local": "ollama:llama3.1:70b",
    "default": "anthropic:claude-sonnet-4-20250514"
  }
}
```

注意：`ollama` 提供商有 `baseUrl`，因此无论提供商名称是什么，都使用代理模式的 ChatOpenAI。

---

> [← 上一篇: 代理循环](./02-agent-loop.md) | [目录](./README.md) | [下一篇: 工具 →](./03-tools.md)
