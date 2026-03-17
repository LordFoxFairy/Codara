# CLI

`src/cli` 是 Codara 的终端宿主层。

它只负责：

1. 找到当前要使用的 `.codara` 目录
2. 把终端输入映射成对 `engine`/`capability` 的调用
3. 渲染 transcript、prompt 和壳层 UI

它不负责重新定义 session、agent、checkpoint 或 metadata 语义，这些都来自 `src/engine` 和 `src/infra`。

## 目录

- `app/`
  - CLI 启动层
  - 只放 CLI shell 装配、controller 和宿主瞬时状态
  - codara runtime 在入口创建后再注入进来
- `composer/`
  - 输入框的纯编辑模型
- `components/`
  - `chrome/` 负责 header、footer、brand 标记
  - `conversation/` 负责 transcript 与空会话区域
  - `prompt/` 负责输入框视口与 prompt frame
  - `permission/` 负责权限审批面板
- `transcript/`
  - 负责把 `engine` / LangChain 消息投影成 CLI transcript 项
- `hooks/`
  - Ink 输入监听

## 边界

- `app/use-cli-controller.ts`
  - 统一协调 UI 状态，并直接消费注入进来的 `engine` 会话实例
  - 不再在 React hook 里创建 session runtime
  - 直接消费 LangChain `AIMessageChunk`，不再维护 CLI 自己的 chunk 适配层
- `app/view-state.ts`
  - 只定义 CLI 宿主侧瞬时 UI 状态，不复制 engine 的 session 语义
- `transcript/model.ts`
  - 统一承接 transcript 可见性与消息投影规则
  - 把 engine runtime events 转成更接近代理步骤流的 CLI 可见项
- `components/chrome/header.tsx`
  - 直接读 `SessionState`，不再引入 CLI 自定义 session metadata 投影
- `main.tsx`
  - 负责宿主级 action，例如 `open_file` 的终端侧处理

## 原则

- CLI 基于 engine/capability/infra，而不是反向推动底层改结构
- CLI 不再复制 engine 已有的 session owner 逻辑
- `.codara` 是 CLI 关心的宿主目录边界，不是新的 runtime owner
- 不在 `.codara` 下再造 `cli/*` 私有命名空间
- 不在 CLI 里预改 `CODARA_PATH`，路径策略由 infra/config 决定
- 允许多级子目录，但每一级都必须有明确 owner，不能回到 `config`、`state`、`adapters` 这类空泛分层

## 校验

- `bun run check:fast`
  - 日常 lint + typecheck 入口
- `bun run check:cases`
  - 优先用于 CLI / runtime 端到端验收
- `bun run lint:cli`
  - 仅检查 `src/cli`
- `bun run lint`
  - 检查整个 `src/` 和 `tests/`
- `bun run typecheck`
  - 统一检查源码和测试的 TypeScript 类型
