# Codara

> AI 驱动的终端代码编辑器

Codara 是一个现代化的 AI 辅助开发工具，支持多模型路由、灵活配置，让 AI 编程更高效。

## ✨ 特性

- 🤖 **多模型支持** - 支持 OpenAI、Anthropic、DeepSeek 等多种 AI 模型
- 🔀 **智能路由** - 灵活的模型路由配置，按需切换不同模型
- 🔐 **安全管理** - 环境变量管理 API Key，支持多 Provider 配置
- ⚡ **高性能** - 基于 Bun 运行时，启动快速、执行高效
- 🎯 **类型安全** - 完整的 TypeScript 类型定义
- 🧪 **测试完备** - 单元测试 + 集成测试，覆盖核心功能

## 📦 技术栈

- **运行时**: [Bun](https://bun.sh/) - 快速的 JavaScript 运行时
- **语言**: [TypeScript](https://www.typescriptlang.org/) - 类型安全的 JavaScript
- **UI**: [React](https://react.dev/) - 用户界面库
- **AI**: [LangChain](https://js.langchain.com/) - AI 应用开发框架
- **验证**: [Zod](https://zod.dev/) - TypeScript 优先的模式验证

## 🚀 快速开始

### 安装依赖

```bash
bun install
```

### 配置模型路由

创建配置文件 `~/.codara/config.json`：

```json
{
  "providers": [
    {
      "name": "openai",
      "models": ["gpt-4o", "gpt-3.5-turbo"],
      "apiKey": "$OPENAI_API_KEY"
    },
    {
      "name": "deepseek",
      "baseUrl": "https://api.deepseek.com",
      "models": ["deepseek-chat"],
      "apiKey": "$DEEPSEEK_API_KEY"
    }
  ],
  "router": {
    "default": "openai:gpt-4o",
    "fast": "openai:gpt-3.5-turbo",
    "deepseek": "deepseek:deepseek-chat"
  }
}
```

### 配置环境变量

创建 `.env` 文件：

```bash
OPENAI_API_KEY=sk-xxx
DEEPSEEK_API_KEY=sk-xxx
```

### 运行

```bash
bun run dev
```

## 🏗️ 项目结构

```
src/
├── core/
│   └── provider/              # 模型 Provider 核心模块
│       ├── config/            # 配置层
│       │   ├── path.ts        # 配置文件路径解析
│       │   ├── schema.ts      # Zod 验证模式
│       │   └── loader.ts      # 配置加载与解析
│       ├── runtime/           # 运行时层
│       │   ├── api-key.ts     # API Key 环境变量展开
│       │   ├── registry.ts    # 模型注册表
│       │   └── factory.ts     # 模型工厂
│       ├── model.ts           # 类型定义
│       └── index.ts           # 统一导出
└── ...

tests/
├── unit/                      # 单元测试
│   └── provider/
│       ├── api-key.test.ts
│       ├── loader.test.ts
│       ├── registry.test.ts
│       └── factory.test.ts
└── integration/               # 集成测试
    └── provider/
        └── deepseek-hello.e2e.test.ts
```

## 🧪 测试

### 运行所有测试

```bash
bun test
```

### 运行单元测试

```bash
bun test tests/unit/provider
```

### 运行集成测试

```bash
# 需要配置真实的 API Key
bun test tests/integration/provider/deepseek-hello.e2e.test.ts
```

### 测试覆盖

Provider 模块采用一对一测试映射：

| 源文件 | 测试文件 |
|--------|---------|
| `config/loader.ts` | `tests/unit/provider/loader.test.ts` |
| `runtime/api-key.ts` | `tests/unit/provider/api-key.test.ts` |
| `runtime/registry.ts` | `tests/unit/provider/registry.test.ts` |
| `runtime/factory.ts` | `tests/unit/provider/factory.test.ts` |

**注意事项**：
- 测试使用 `bun:test`，请使用 `bun test` 执行
- 集成测试会发起真实网络请求，需要配置有效的 API Key
- 单元测试使用 mock 数据，无需网络请求

## 🛠️ 开发

### 代码检查

```bash
bun run lint
```

### 代码格式化

```bash
bun run format
```

### 构建

```bash
bun run build
```

## 📖 核心概念

### Provider

Provider 是 AI 模型的提供方，例如 OpenAI、Anthropic、DeepSeek 等。每个 Provider 包含：

- `name`: Provider 唯一标识
- `baseUrl`: API 端点（可选，用于兼容 OpenAI 协议的服务）
- `apiKey`: API 密钥（支持环境变量引用，格式：`$ENV_NAME`）
- `models`: 该 Provider 支持的模型白名单

### Router

Router 定义了模型别名到具体模型的映射关系，格式为 `provider:model`。

例如：
- `"default": "openai:gpt-4o"` - 将 `default` 别名映射到 OpenAI 的 gpt-4o 模型
- `"fast": "openai:gpt-3.5-turbo"` - 将 `fast` 别名映射到更快的模型

### 使用示例

```typescript
import {loadModelRoutingConfig, ModelRegistry, ChatModelFactory} from "@core/provider";

// 1. 加载配置
const config = await loadModelRoutingConfig();

// 2. 创建注册表
const registry = new ModelRegistry(config);

// 3. 创建工厂
const factory = new ChatModelFactory(registry);

// 4. 创建模型实例
const model = await factory.create("default");

// 5. 调用模型
const response = await model.invoke("Hello, AI!");
console.log(response.content);
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

### 开发规范

- 遵循 TypeScript 最佳实践
- 保持测试覆盖率
- 使用语义化的 commit message（参考 [Conventional Commits](https://www.conventionalcommits.org/)）

### Commit 规范

```
<type>(<scope>): <subject>

type: feat | fix | refactor | test | docs | chore
scope: 影响范围，如 core/provider
subject: 简短描述
```

示例：
```
feat(core/provider): 增加模型路由配置功能
fix(core/provider): 修复环境变量解析错误
refactor(core/provider): 优化命名并合并配置解析逻辑
```

## 📄 License

MIT © [LordFoxFairy](https://github.com/thefoxfairy)

---

**Made with ❤️ by LordFoxFairy**
