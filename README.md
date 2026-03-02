# Codara

AI 驱动的终端代码协作器，采用 `Agent Loop + Hooks + Skills` 架构。

## 文档入口

- 总索引：[`docs/README.md`](./docs/README.md)
- 运行时主线：[`docs/architecture-runtime.md`](./docs/architecture-runtime.md)

如果要接手实现，优先阅读运行时主线，再按章节深入。

## 架构原则

- 核心运行时负责稳定机制（循环、工具、权限、钩子、记忆）。
- Skills 负责场景策略与团队流程（优先在 Skills 扩展，而非核心硬编码）。
- 文档以“模块职责和契约”为主，避免文件路径绑定实现。

## 技术栈

- Bun + TypeScript + React

## 开发

```bash
# 安装依赖
bun install

# 代码检查
bun run lint

# 代码格式化
bun run format

# 构建
bun run build
```

## License

MIT
