# Summary Module

## 目录结构

```text
src/core/middleware/summary/
├── types.ts        # 摘要输入、记录与配置合同
├── state.ts        # 摘要在 agent context 中的读写与消息裁剪
├── format.ts       # 将摘要格式化为系统消息片段
├── middleware.ts   # 在模型调用前执行摘要压缩与注入
└── index.ts
```

## 职责

- 在消息历史过长时压缩较早消息
- 将摘要写回 agent `context`
- 在后续模型调用时将摘要注入系统消息

## 不负责什么

- 不写入 `MEMORY.md`
- 不改变 checkpoint 结构
- 不管理 session 生命周期
- 不自动决定长期记忆沉淀

## 设计说明

`summary` 是一个可选 middleware，用来管理长对话的上下文窗口。
它与 `memory`、`guidelines`、`checkpoint` 的关系如下：

- `guidelines`：项目规范
- `memory`：长期记忆
- `summary`：当前/近期会话压缩
- `checkpoint`：运行恢复

摘要结果写入 agent `context`，因此会被现有 checkpoint 机制自然持久化；
但 `summary` 不会额外引入新的 checkpoint 专用结构。
