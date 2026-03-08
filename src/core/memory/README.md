# Memory Module

## 目录结构

```text
src/core/memory/
├── types.ts        # MEMORY.md 记忆源的最小类型边界
├── store.ts        # MEMORY.md 的最小读写接口
├── writer.ts       # MEMORY.md 的受控写回接口
├── discovery.ts    # 发现全局与项目 MEMORY.md
├── loader.ts       # 读取并组合 MEMORY.md 内容
├── format.ts       # 将记忆源格式化为系统消息片段
├── middleware.ts   # 在模型调用前注入 MEMORY.md 记忆
└── index.ts
```

## 职责

- 发现并加载 `MEMORY.md`
- 提供最小读写接口，供 CLI / tool / 上层服务使用
- 提供受控写回接口，供长期记忆沉淀使用
- 将 `MEMORY.md` 长期记忆注入模型系统消息
- 为 `createCodaraMiddlewares(...)` 提供默认长期记忆能力

## 当前规则

1. 标准文件名为 `MEMORY.md`
- 当前记忆源只解析 `MEMORY.md`
- 文件名解析保持单一标准，不引入额外别名

2. 只加载两层
- 全局：`~/.codara/MEMORY.md`
- 项目：`<workspaceRoot>/MEMORY.md`

3. 工作区根解析
- 显式传入 `projectRoot` 时直接使用
- 否则从 `cwd` 向上查找 `.codara`、`.git`、`package.json`
- 都不存在时回退到当前 `cwd`

4. 不做缓存
- 每次模型调用重新读取
- 优先保证修改后立即生效

5. 默认限制注入长度
- 单个 `MEMORY.md` 默认最多注入 `12_000` 个字符
- 超出部分会被截断并标记为 `[truncated]`

6. 注入顺序固定
- `LoggingMiddleware`
- `AgentsGuidelinesMiddleware`
- `MemoryMiddleware`
- `SkillsMiddleware`
- caller middlewares
- `HumanInTheLoopMiddleware`

## 不负责什么

- 不负责项目规范（`AGENTS.md`）
- 不负责运行恢复（`checkpoint`）
- 不负责技能发现（`skills`）
- 不负责会话宿主状态（`session`）
- 不负责自动总结或自动沉淀策略

## 设计说明

`MEMORY.md` 在 Codara 中被视为长期记忆源，而不是 checkpoint 或 guidelines。
它表达的是：

- 稳定事实
- 长期偏好
- 可复用经验
- 跨会话沉淀的项目知识

因此它应当晚于 `AGENTS.md` 注入，但不应和 `checkpoint`、`session` 混层。

## 最小读写接口

```ts
import {createMemoryStore} from '@core/memory';

const memory = createMemoryStore({cwd: process.cwd()});

await memory.write('project', '# Stable project memory');
const content = await memory.read('project');
```

当前只支持两个 scope：
- `global`
- `project`

类型边界分为两层：
- `MemorySourceOptions`：只负责定位文件
- `MemoryLoadOptions`：在定位基础上追加注入控制（如 `maxChars`）

## 最小写回接口

```ts
import {createMemoryWriter} from '@core/memory';

const writer = createMemoryWriter({cwd: process.cwd()});

await writer.remember('project', {
  kind: 'lesson',
  content: 'Run lint before opening a PR.',
});
```

当前写回遵循这些规则：
- 只写长期稳定内容
- 不写 checkpoint、pending pause、临时任务状态
- 将 Codara 管理的条目写入 `## Codara Memory` 块
- 对同一 section 做精确去重

当前支持三类条目：
- `preference`
- `fact`
- `lesson`
