# Agents

`src/engine/agent/index.ts` 是唯一对外入口。

根目录只保留：
- `index.ts`：公开 API
- `README.md`：结构说明

其余实现按两个具体目录收口：

```text
agent/
  index.ts
  README.md
  models/
    agent.ts
    command.ts
    state.ts
  run/
    agent-loop.ts
    turn.ts
    stream.ts
    tool-executor.ts
```

职责划分：
- `models/agent.ts`：agent 的公开合同与核心类型
- `models/command.ts`：state update command 与 context merge
- `models/state.ts`：runtime state / checkpoint projection
- `run/agent-loop.ts`：`createAgent(...)` 与 run loop 主链
- `run/turn.ts`：单轮 `model -> tools` 执行
- `run/stream.ts`：stream 输出适配
- `run/tool-executor.ts`：LangChain tool 调用适配

读取顺序建议：
1. `index.ts`
2. `run/agent-loop.ts`
3. `run/turn.ts`
4. 需要时再看 `run/stream.ts`、`run/tool-executor.ts` 和 `models/*`
