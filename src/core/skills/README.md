# Skills Module

## 目录结构

```
src/core/skills/
├── types.ts         # 核心类型边界（SkillMetadata / SkillStore）
├── loading.ts       # SKILL.md frontmatter 解析与校验（deepagents + Agent Skills 对齐）
├── store.ts         # 文件系统技能发现（source layering + cache）
├── metadata.ts      # skills 元数据 schema/reducer + prompt 模板与格式化
├── middleware.ts    # deepagents 风格单文件编排（发现 + prompt 注入）
└── index.ts
```

## 设计原则

1. 标准优先
- `SkillMetadata` 只保留 Agent Skills/deepagents 核心字段。
- 平台特有字段（如 Claude 扩展 frontmatter）不进入主类型语义，统一保留在 `extensions`/`frontmatter`。
- `SKILL.md` 必须包含有效 YAML frontmatter，且 `name/description` 为必填（与规范一致）。

2. 扩展方式
- skills 只做 skills 本职，不内建二次扩展框架。
- 若要审计/风控/观测，请在 pipeline 里追加独立 middleware，不把扩展逻辑塞回 skills 核心。

3. allowed-tools 语义
- 当前仅用于技能元数据展示（与 deepagents 主线一致）。

## 当前边界

1. 已支持
- deepagents 风格 skills prompt 注入。
- source layering（后 source 覆盖前 source）。
- 技能缓存策略下放到 `store`（例如 `FileSystemSkillStore` 的 TTL 缓存）。
- `allowed-tools` 元数据在 prompt 中展示。

2. 不在当前范围
- 技能推荐/召回引擎。
- 并行多技能冲突解决策略。
- 与命令系统的深度联动 DSL。
