# Sources

`src/core/sources/*` 是 source lifecycle owner。

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
product/assembly
  -> create source instances
session bootstrap
  -> preload source snapshots once
agent turn preparation
  -> read source snapshots
  -> assemble system layers
middleware
  -> runtime interception only
```

这层存在的目的，是把“要在 session init 时预热的数据”从 `middleware/*` 和 `sessions/*` 中解耦出来，避免 source lifecycle 和 runtime hooks 混成一个概念。
