# Resources

`src/core/resources/*` 是 session 预热资源域。

它负责：

- `AGENTS.md` 发现与内容投影
- skills discovery 与 runtime projection
- session-scoped cache
- reload invalidation
- inspect / ensure 这类 host helper

它不负责：

- `session` host lifecycle
- `agent` turn loop
- `middleware` runtime interception

当前主链是：

```text
codara/facade
  -> create resource instances
session bootstrap
  -> preload resource snapshots once
session-owned system layers
  -> cache stable projections once
agent loop preparation
  -> read session-owned layers
  -> merge runtime shared data
middleware
  -> runtime interception only
```

这层存在的目的，是把“要在 session init 时预热的数据”从 `middleware/*` 中解耦出来。`resources/*` 只负责发现、加载、reload 和 projection；真正把稳定 system 层传给 agent loop 的 owner 是 `session`。
