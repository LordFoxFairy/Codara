# CLI

`src/cli` 是 Codara 的终端宿主层。

它只负责：

1. 找到当前要使用的 `.codara` 目录
2. 把终端输入映射成对 `core` 的调用
3. 渲染 transcript、prompt 和壳层 UI

它不负责重新定义 session、agent、checkpoint 或 metadata 语义，这些都来自 `src/core`。

## 目录

- `app/`
  - CLI 启动层
  - 只放 CLI shell 装配、controller 和宿主瞬时状态
  - core runtime 在入口创建后再注入进来
- `composer/`
  - 输入框的纯编辑模型
- `components/`
  - `chrome/` 负责 header、footer、brand 标记
  - `conversation/` 负责 transcript 与空会话区域
  - `prompt/` 负责输入框视口与 prompt frame
- `transcript/`
  - 负责把 `core` / LangChain 消息投影成 CLI transcript 项
- `hooks/`
  - Ink 输入监听

## 边界

- `app/use-cli-controller.ts`
  - 统一协调 UI 状态，并直接消费注入进来的 `core` 会话实例
  - 不再在 React hook 里创建 session runtime
  - 直接消费 LangChain `AIMessageChunk`，不再维护 CLI 自己的 chunk 适配层
- `app/view-state.ts`
  - 只定义 CLI 宿主侧瞬时 UI 状态，不复制 core 的 session 语义
- `transcript/model.ts`
  - 统一承接 transcript 可见性与消息投影规则
- `components/chrome/header.tsx`
  - 直接读 `SessionState`，不再引入 CLI 自定义 session metadata 投影

## 原则

- CLI 基于 core，而不是反向推动 core 改结构
- CLI 不再复制 core 已有的 session owner 逻辑
- `.codara` 是 CLI 关心的宿主目录边界，不是新的 runtime owner
- 不在 `.codara` 下再造 `cli/*` 私有命名空间
- 不在 CLI 里预改 `CODARA_PATH`，路径策略由 core 决定
- 允许多级子目录，但每一级都必须有明确 owner，不能回到 `config`、`state`、`adapters` 这类空泛分层

## 校验

- `bun run lint:cli`
  - 仅检查 `src/cli`
- `bun run lint`
  - 检查整个 `src/` 和 `tests/`
- `bun run typecheck`
  - 统一检查源码和测试的 TypeScript 类型
