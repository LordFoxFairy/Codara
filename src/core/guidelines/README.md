# Guidelines Module

## 目录结构

```text
src/core/guidelines/
├── types.ts        # AGENTS.md 规范源的最小类型边界
├── discovery.ts    # 发现全局与项目 AGENTS.md
├── loader.ts       # 读取并组合 AGENTS.md 内容
├── format.ts       # 将规范源格式化为系统消息片段
├── middleware.ts   # 在模型调用前注入 AGENTS.md 规范
└── index.ts
```

## 职责

- 发现并加载 `AGENTS.md`
- 将 `AGENTS.md` 规范注入模型系统消息
- 为 `createCodaraMiddlewares(...)` 提供默认项目规范能力

## 当前规则

1. 标准文件名为 `AGENTS.md`
- 当前规范源只解析 `AGENTS.md`
- 文件名解析保持单一标准，不引入额外别名

2. 只加载两层
- 全局：`~/.codara/AGENTS.md`
- 项目：`<workspaceRoot>/AGENTS.md`

3. 工作区根解析
- 显式传入 `projectRoot` 时直接使用
- 否则从 `cwd` 向上查找 `.codara`、`.git`、`package.json`
- 都不存在时回退到当前 `cwd`

4. 不做缓存
- 每次模型调用重新读取
- 优先保证修改后立即生效

5. 注入顺序固定
- `LoggingMiddleware`
- `GuidelinesMiddleware`
- `SkillsMiddleware`
- caller middlewares
- `HumanInTheLoopMiddleware`

## 不负责什么

- 不负责长期记忆（`memory`）
- 不负责运行恢复（`checkpoint`）
- 不负责技能发现（`skills`）
- 不负责会话宿主状态（`session`）

## 设计说明

`AGENTS.md` 在 Codara 中被视为项目规范源，而不是技能或记忆。
它表达的是：

- 项目约束
- 工作流要求
- 编码规范
- 行为边界

因此它应该先于 skills 注入，但不应和 `memory`、`checkpoint` 混层。
