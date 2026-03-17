# Engine

`engine/` 是 Codara 的核心运行时引擎层，包含 session、agent、pipeline（middleware）和 hook 四个子域。

它负责：
- `agent/` — agent 模型定义、agent loop 执行、流式输出
- `session/` — session 生命周期、状态存储
- `events/` — runtime events 与事件桥接能力
- `pipeline/` — middleware 管道（permission、HIL、budget、logging、skills、summary 等）
- `hook/` — 9 种 hook 事件、registry、executor、pipeline

它不负责：
- 工具定义（→ `capability/tool`）
- 技能发现与加载（→ `capability/skill`）
- 模型提供者（→ `infra/provider`）
- Facade 装配（→ `codara/`）

依赖规则：engine 可依赖 shared，不可反向依赖 capability 或 infra。
