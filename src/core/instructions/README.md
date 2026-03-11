# Instructions

`instructions/*` 是 session 预热、agent 每轮消费的指令域。

它现在只包含两类东西：

- `guidelines/*`
  - `AGENTS.md` 的发现、加载、inspect、ensure、缓存
- `skills/*`
  - skills 的 store、loading、runtime projection、commands、metadata

边界：

- `session`
  - 负责 preload / reload 这层
- `agent`
  - 负责每次运行时消费已经准备好的指令快照
- `middleware`
  - 只负责运行时拦截，不拥有 instructions lifecycle
