# Skills Resource Domain

## 目录结构

```text
src/core/instructions/skills/
  source.ts      # session-scoped SkillsSource
  store.ts       # 文件系统技能发现（source layering + cache）
  loading.ts     # SKILL.md frontmatter 解析与校验
  metadata.ts    # metadata schema/reducer + prompt 格式化
  runtime.ts     # runtime projection + subagent definitions
  commands.ts    # skill command discovery
  types.ts       # SkillMetadata / SkillStore
  index.ts
```

## 设计原则

1. 标准优先
- `SkillMetadata` 只保留 Agent Skills/deepagents 核心字段。
- 平台特有字段（如 Claude 扩展 frontmatter）不进入主类型语义，统一保留在 `extensions`/`frontmatter`。
- `SKILL.md` 必须包含有效 YAML frontmatter，且 `name/description` 为必填（与规范一致）。

2. 扩展方式
- skills 只做 skills 本职，不内建二次扩展框架。
- 若要审计/风控/观测，请在 `middleware/*` 里追加独立 middleware，不把扩展逻辑塞回 skills source 核心。
- 若要暴露手动入口，优先通过显式的 command 元数据接入 Codara commands，而不是再开一条平行触发系统。

3. allowed-tools 语义
- 当前仅用于技能元数据展示（与 deepagents 主线一致）。

4. command-name 语义
- `command-name` / `command-description` / `command-usage` / `command-aliases` 用于声明宿主级 slash command。
- skills 负责声明，Codara command registry 负责暴露，Session/agent 负责执行。
- 这条链复用同一份 skills discovery，不再开旁路。
- 命令来源会被正式标记为 `skill`，与内建 `builtin` agent commands 区分开。

## 当前边界

1. 已支持
- deepagents 风格 skills prompt 注入由 `middleware/skills.ts` 提供。
- source layering（后 source 覆盖前 source）。
- 技能缓存策略下放到 `store`（例如 `FileSystemSkillStore` 的 TTL 缓存）。
- `allowed-tools` 元数据在 prompt 中展示。

2. 不在当前范围
- 技能推荐/召回引擎。
- 并行多技能冲突解决策略。
- 更重的命令 DSL 或独立技能执行框架。
