# 生命周期钩子

> [← 上一篇: 工具](./03-tools.md) | [目录](./README.md) | [下一篇: 记忆系统 →](./05-memory-system.md)

## 概述

钩子（Hooks）允许你在代理生命周期事件发生时运行自定义操作。它们在 `settings.json` 中配置，并遵循 Claude Code 兼容的约定。

使用钩子来执行项目策略、转换工具输入、记录活动、触发外部工作流或阻止不安全操作 —— 所有这些都无需修改代理核心代码。

## 主轴定位（Agent Loop + Hooks）

在 Codara 的文档主线上，`hooks` 是 `agent loop` 之后的第一扩展面。  
`permissions`、`security-check`、`audit-logger`、协作策略等能力，推荐都通过 skills 在 hooks 之上编排，而不是继续扩展核心硬编码分支。

## Hooks 层契约

| 项 | 契约定义 |
|---|---|
| 输入 | 生命周期事件上下文（工具信息、会话信息、运行状态） |
| 输出 | 批准/拒绝/修改动作，以及可选的附加上下文 |
| 主路径 | 事件触发 -> 匹配器筛选 -> 执行钩子 -> 汇总动作 |
| 失败路径 | 超时、命令异常、退出码拒绝、JSON 动作解析失败 |

实现约束：
- Hooks 负责“拦截与变换”，不负责业务流程编排。
- 同一事件支持多钩子串联，但首个拒绝必须短路。
- 钩子失败必须可观测（日志/事件/错误反馈），禁止静默吞错。

### HookMiddleware 与 HookEngine 的分工

建议把 hooks 实现拆成两层：

| 层 | 职责 | 典型接口 |
|---|---|---|
| `HookMiddleware` | 接入生命周期、构造上下文、执行短路与回写 | `wrapToolCall(ctx, next)` |
| `HookEngine` | 匹配规则、执行 handler、合并动作 | `evaluate(event, ctx) -> HookDecision` |

约束：

1. `HookEngine` 不直接调用 `next()`，只返回决策结果。
2. `HookMiddleware` 负责把 Engine 决策映射为真正的 `deny/modify/allow` 行为。
3. Skills hooks、settings hooks 都先进入同一个 HookEngine，再由 Middleware 统一执行语义。

## 本文与 06/05 的关系

- 本文（04）定义 **Hooks 原语**：事件、动作类型、执行模型、退出码。
- [06-skills](./06-skills.md) 定义 **能力编排**：如何用 skill 组合 hooks + permissions。
- [appendix/permissions](./appendix/permissions.md) 是附录速查：仅保留权限策略细节，不作为独立主线。

## Hook 与 Permission 一体化策略

在运行时，`permissions` 不是和 hooks 并列的“独立产品入口”，而是工具调用链中的策略层：

```
PreToolUse Hooks → Permission 求值 → Tool 执行 → PostToolUse Hooks
```

这条链路决定了职责边界：
- **Hooks**：先拦截、可拒绝、可改写输入（硬策略）。
- **Permissions**：用户授权与规则求值（交互策略）。
- **Skills**：把 hooks + permissions 组合成可复用能力（业务策略）。

### 标准化动作输出（建议实现）

建议 Hook 引擎对动作做统一归一化，避免各钩子各自返回格式导致冲突：

```json
{
  "action": "allow | deny | modify",
  "source": "hook",
  "reason": "string",
  "modifiedInput": {},
  "request_id": "string"
}
```

约束：

1. 同一 `PreToolUse` 链只接受第一个 `deny`（短路）。
2. 多个 `modify` 按执行顺序叠加，并产出最终输入快照。
3. 非法 JSON 或未知 `action` 视为执行失败并记录告警。

### Hook 输出如何进入统一裁决

Hook 的输出不应直接跳过权限层，而应归一化为裁决输入，再进入 Permission 求值：

`HookResult -> DecisionDraft -> PermissionDecision -> FinalDecision`

边界约束：

1. `PreToolUse` 的 `modify` 只改输入，不直接给出最终 `allow`。
2. `PreToolUse` 的 `deny` 可直接形成最终 `FinalDecision=deny`。
3. 未拒绝时，最终放行与否由 Permission 链给出。
4. `FinalDecision` 必须带 `request_id` 与 `source`，用于日志和 UI 解释。

## 钩子周期设计（时序）

### 单次工具调用周期

| 周期阶段 | 输入上下文 | 可执行动作 | 短路/终止条件 | 输出结果 |
|---|---|---|---|---|
| `PreToolUse` 链 | 工具名 + toolInput + `session_id/turn_id/request_id` | deny / modify / log | 首个拒绝立即短路 | 修改后的输入或拒绝原因 |
| Permission 求值 | 工具标识 + 最终输入 + 规则集 | allow / ask / deny | deny 直接终止；ask 等待用户决策 | 授权决策 |
| 工具执行 | 已授权工具调用 | 实际执行 | 执行异常进入失败路径 | 工具输出或错误 |
| `PostToolUse`/`PostToolUseFailure` 链 | 工具输出或错误 + 上下文 | log / notify / side effect | 通常不阻断主路径 | 审计与后处理结果 |

关键约束：
- `PreToolUse` 只负责“前置拦截与变换”，不应承担最终授权决策。
- `Permission` 只负责授权，不做输入改写。
- `PostToolUse*` 主要用于日志、通知、审计，不回写工具输入。
- 钩子链与权限链共同形成“拦截 -> 校验 -> 执行 -> 记录”的闭环。

工程建议：

1. 为每次工具调用生成 `request_id`，贯穿 Hook/Permission/Tool 全链路。
2. `PostToolUseFailure` 记录失败域（hook / permission / tool / runtime）。
3. Hook 超时策略显式配置：默认 `allow`，安全关键链路可设 `deny`。

### 会话级钩子周期

除了工具调用周期，钩子还覆盖会话周期：

1. `SessionStart`：会话初始化完成后触发（可做审计登记、环境检查）。
2. `UserPromptSubmit`：每次用户提交输入后触发（可做输入策略检查）。
3. `Stop` / `SessionEnd`：会话结束前后触发（可做收尾校验、归档日志）。

这保证 hooks 不仅能拦截工具，还能覆盖“启动 -> 执行 -> 结束”的全过程。

### 与 `/skill` 激活的边界

1. 技能钩子在会话初始化时加载并进入会话级钩子视图。
2. `/skill` 调用只激活提示与临时权限，不动态挂载/卸载钩子。
3. 技能结束后回收的是临时权限；钩子随会话生命周期统一释放。

### 权限模式（作为 Hook 链中的策略步骤）

| 模式 | 行为 |
|------|------|
| `default` | 自动允许 Read/Glob/Grep，其余询问 |
| `acceptEdits` | 自动允许只读 + Write/Edit，Bash 询问 |
| `plan` | 仅只读自动允许，Write/Edit 拒绝 |
| `dontAsk` | 不弹框，未命中 allow 即拒绝 |
| `bypassPermissions` | 全放行（高风险） |

### 规则求值顺序（简版）

1. `bypassPermissions`  
2. `plan` 特判  
3. `deny`  
4. `ask`  
5. `allow`（含 skill 的 `allowed-tools` 临时规则）  
6. 只读豁免  
7. `acceptEdits`  
8. `dontAsk`  
9. 兜底询问

完整的规则语法、会话/持久化授权与实践边界，见 [权限策略附录](./appendix/permissions.md)。

### 设计建议

1. 把“必须阻断/改写”的逻辑放到 `PreToolUse`。  
2. 把“需要用户授权”的逻辑交给 `permissions`。  
3. 把“某个场景怎么组合这两者”封装成 skill，而不是长期手写 `settings.json`。  

## 钩子事件

Codara 支持 16 个生命周期事件。每个事件在代理执行的特定时刻触发，并接收与该时刻相关的上下文数据。

### 事件模型：Core Events 与 Extension Events

为保证兼容性与扩展性并存，事件分两层：

1. **Core Events（固定集）**：本文定义的 16 个生命周期事件，长期稳定、优先兼容。
2. **Extension Events（扩展集）**：由运行时模块或插件在启动时注册的新事件。

设计约束：

1. Core Events 不允许被 skills 直接改语义或删除。
2. Extension Events 必须先注册后使用，禁止“未注册字符串事件”被静默接受。
3. 未识别事件在 Hook 配置校验阶段直接报错（fail-fast）。
4. 扩展事件不改变主循环分支语义，只增加可观测点或策略触发点。

### 扩展事件注册契约（建议实现）

建议每个扩展事件都提供如下元信息：

```json
{
  "name": "ext.team.task_claimed",
  "version": "1.0.0",
  "phase": "team",
  "stability": "experimental|stable",
  "payload_schema": "json-schema-id",
  "owner": "team-runtime"
}
```

注册与兼容规则：

1. `name` 采用命名空间（如 `ext.<domain>.<event>`），避免与 Core Events 冲突。
2. `version` 变更遵循向后兼容策略；破坏性变更必须升主版本。
3. `payload_schema` 必须可校验，Hook 执行前先做结构校验。
4. 运行时启动时构建事件注册表，HookEngine 只消费注册表中的事件。

### 会话生命周期

| 事件 | 触发时机 |
|-------|--------------|
| `SessionStart` | 新的代理会话开始时 |
| `SessionEnd` | 会话结束时（正常完成、错误或中断） |

### 用户输入

| 事件 | 触发时机 |
|-------|--------------|
| `UserPromptSubmit` | 用户提交提示词后，代理处理之前 |

### 工具生命周期

| 事件 | 触发时机 |
|-------|--------------|
| `PreToolUse` | 工具执行之前。可以**修改输入**或**拒绝**执行 |
| `PostToolUse` | 工具成功执行之后 |
| `PostToolUseFailure` | 工具执行失败之后 |

### 代理控制

| 事件 | 触发时机 |
|-------|--------------|
| `Stop` | 代理循环即将停止时。拒绝此事件可强制代理继续运行 |
| `PermissionRequest` | 工具调用触发权限对话框时 |

### 子代理生命周期

| 事件 | 触发时机 |
|-------|--------------|
| `SubagentStart` | 子代理被生成时 |
| `SubagentStop` | 子代理完成时 |

### 上下文管理

| 事件 | 触发时机 |
|-------|--------------|
| `PreCompact` | 上下文压缩运行之前（上下文窗口接近限制时） |

### 任务与通知

| 事件 | 触发时机 |
|-------|--------------|
| `TaskCompleted` | 后台任务完成时 |
| `Notification` | 发出通用通知时 |

### 配置与工作树

| 事件 | 触发时机 |
|-------|--------------|
| `ConfigChange` | 配置文件被修改时 |
| `WorktreeCreate` | git worktree 被创建时 |
| `WorktreeRemove` | git worktree 被移除时 |

## 配置

钩子在 `settings.json` 文件的 `hooks` 键下配置。每个事件映射到一个匹配器数组，每个匹配器包含一个 glob 模式和一组钩子命令。

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "echo 'Bash tool is about to run'" }
        ]
      }
    ]
  }
}
```

### 匹配器结构

```json
{
  "matcher": "<glob pattern>",
  "hooks": [
    { "type": "command", "command": "<shell command>" }
  ]
}
```

- **`matcher`** — 用于过滤哪些工具调用触发钩子的 glob 模式。仅与工具相关的事件（`PreToolUse`、`PostToolUse`、`PostToolUseFailure`）有效。空字符串匹配所有工具。
- **`hooks`** — 匹配器匹配时执行的操作数组。每个操作包含 `type` 字段和对应的配置。

### 钩子类型

Codara 支持 4 种钩子操作类型：

| 类型 | 描述 | 用途 |
|------|------|------|
| `command` | 执行 shell 命令 | 脚本验证、日志记录、阻止操作 |
| `http` | 发送 POST 到指定 URL | 外部 webhook、远程审计 |
| `prompt` | 将文本注入对话上下文 | 动态提示注入、上下文增强 |
| `agent` | 生成子代理处理事件 | 复杂的事件响应逻辑 |

每种类型的配置格式：

```json
// command — 执行 shell 命令
{ "type": "command", "command": "echo hello" }

// http — 发送 POST 请求到指定 URL
{ "type": "http", "url": "https://example.com/hook", "timeout": 30000 }

// prompt — 将文本注入当前对话上下文
{ "type": "prompt", "prompt": "Remember to check for security issues" }

// agent — 生成子代理处理事件
{ "type": "agent", "agent": "security-reviewer", "prompt": "Review this tool call" }
```

所有类型均支持可选的 `timeout` 字段（毫秒），覆盖默认的 10 秒超时：

```json
{ "type": "command", "command": "slow-lint.sh", "timeout": 60000 }
```

### Glob 模式示例

| 模式 | 匹配 |
|---------|---------|
| `"Bash"` | 精确匹配 Bash 工具 |
| `"Bash*"` | Bash、BashBackground 等 |
| `"*"` | 所有工具 |
| `""` | 所有工具（空 = 匹配一切） |
| `"Read"` | 精确匹配 Read 工具 |
| `"Edit"` | 精确匹配 Edit 工具 |

模式使用 [minimatch](https://github.com/isaacs/minimatch) 进行 glob 匹配。

### 每个事件多个钩子

你可以为每个事件配置多个匹配器，也可以为每个匹配器配置多个钩子命令：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "/path/to/validate-bash.sh" },
          { "type": "command", "command": "/path/to/log-bash.sh" }
        ]
      },
      {
        "matcher": "Write",
        "hooks": [
          { "type": "command", "command": "/path/to/validate-write.sh" }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "echo 'Session started'" }
        ]
      }
    ]
  }
}
```

## 执行模型

当钩子命令运行时，上下文通过**环境变量**和 **stdin** 两种方式传递。

### 环境变量

| 变量 | 描述 |
|----------|-------------|
| `HOOK_EVENT` | 事件名称（例如 `PreToolUse`、`SessionStart`） |
| `TOOL_NAME` | 被调用的工具（非工具事件时为空） |
| `TOOL_INPUT` | JSON 编码的工具输入参数 |
| `SESSION_ID` | 当前会话标识符 |
| `CWD` | 代理的工作目录 |
| `CLAUDE_PROJECT_DIR` | 同 `CWD`（Claude Code 兼容性） |
| `TOOL_OUTPUT` | 工具输出（仅 `PostToolUse` 时设置） |
| `TOOL_ERROR` | 工具错误信息（仅 `PostToolUseFailure` 时设置） |
| `STOP_REASON` | 代理停止原因（仅 `Stop` 时设置） |
| `PRE_TOKENS` | 压缩前的 token 数量（仅 `PreCompact` 时设置） |

### stdin JSON 负载

完整的事件上下文也会作为 JSON 对象写入钩子命令的 stdin：

```json
{
  "event": "PreToolUse",
  "tool": "Bash",
  "input": { "command": "rm -rf /tmp/test" },
  "output": null,
  "error": null,
  "sessionId": "abc-123",
  "cwd": "/home/user/project",
  "stopReason": null
}
```

这允许钩子在环境变量不够用时解析结构化数据。使用标准工具从 stdin 读取：

```bash
#!/bin/bash
# 从 stdin 读取完整的 JSON 上下文
CONTEXT=$(cat)
TOOL=$(echo "$CONTEXT" | jq -r '.tool')
COMMAND=$(echo "$CONTEXT" | jq -r '.input.command')
```

### 超时

钩子命令有 **10 秒超时**。如果命令在 10 秒内未退出，将收到 `SIGTERM` 信号，钩子被视为已批准（代理继续执行）。

对安全关键场景（例如危险命令阻断），不要只依赖超时行为。应同时配置一条 permissions `deny` 兜底规则，避免钩子超时导致放行。

工程建议（实现侧）：
- 默认 `on_timeout = allow`（保持可用性，避免卡死主流程）
- 安全关键钩子支持 `on_timeout = deny`（fail-closed）

## 退出码约定

钩子命令的退出码决定了代理如何继续：

| 退出码 | 含义 | 行为 |
|-----------|---------|----------|
| **0** | 批准 | 继续执行。stdout 可包含 JSON 操作（见下文） |
| **2** | 拒绝/阻止 | 工具执行被阻止。stderr 用作拒绝原因 |
| **其他** | 批准（带警告） | 继续执行。stderr 作为警告记录 |

### 退出码 2 — 拒绝

当钩子以退出码 2 退出时，工具调用被阻止，stderr 中的拒绝原因会作为反馈传回代理。

```bash
#!/bin/bash
# 阻止危险的 rm 命令
COMMAND=$(echo "$TOOL_INPUT" | jq -r '.command // ""')
if echo "$COMMAND" | grep -q "rm -rf /"; then
  echo "Refusing to run destructive rm command on root" >&2
  exit 2
fi
```

### 退出码 0 — 批准并可选 JSON 操作

当钩子以退出码 0 退出时，会检查 stdout 中的 JSON 操作。如果 stdout 不是有效的 JSON，则视为附加上下文（仅供参考）。

## PreToolUse 操作

对于以退出码 0 退出的 `PreToolUse` 钩子，stdout 可以包含一个 JSON 对象来修改或拒绝工具调用。

### 拒绝操作

```json
{"action": "deny", "reason": "This operation is not permitted"}
```

等同于以退出码 2 退出。`reason` 字段是可选的，默认为 "Hook denied"。

### 修改操作

```json
{"action": "modify", "modifiedInput": {"command": "echo 'sanitized command'"}}
```

`modifiedInput` 对象替换工具的输入参数。修改后的输入随后传递给后续钩子，最终传递给工具本身。

### 示例：改写不安全的命令

```bash
#!/bin/bash
# 将写入重定向到安全目录
CONTEXT=$(cat)
FILE_PATH=$(echo "$CONTEXT" | jq -r '.input.file_path // ""')

if [[ "$FILE_PATH" == /etc/* ]]; then
  SAFE_PATH="/tmp/sandbox${FILE_PATH}"
  echo "{\"action\": \"modify\", \"modifiedInput\": $(echo "$CONTEXT" | jq ".input + {\"file_path\": \"$SAFE_PATH\"}")}"
  exit 0
fi
```

## 首次拒绝短路

当同一事件配置了多个钩子时，它们**按顺序**运行。第一个返回**拒绝**结果的钩子会立即停止后续钩子的执行。该事件的后续钩子不会被评估。

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "/path/to/security-check.sh" },
          { "type": "command", "command": "/path/to/audit-log.sh" }
        ]
      }
    ]
  }
}
```

在此示例中，如果 `security-check.sh` 以退出码 2 退出，`audit-log.sh` 将**不会**运行。

对于**修改**结果，修改后的输入会被传递给链中的下一个钩子。这允许钩子组合转换。

## 实践示例

### 阻止所有文件删除

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "if echo \"$TOOL_INPUT\" | jq -r '.command' | grep -qE '\\brm\\b'; then echo 'rm commands are blocked' >&2; exit 2; fi" }
        ]
      }
    ]
  }
}
```

### 记录所有工具使用

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "echo \"$(date -Iseconds) $TOOL_NAME\" >> /tmp/codara-tool-log.txt" }
        ]
      }
    ]
  }
}
```

### 防止代理过早停止

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "echo 'Keep going — not done yet' >&2; exit 2" }
        ]
      }
    ]
  }
}
```

当 `Stop` 钩子拒绝时，代理循环继续而非停止。

### 会话开始时通知

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "curl -sS -X POST http://localhost:9000/hooks/session-start -H 'content-type: application/json' -d '{\"event\":\"SessionStart\"}' >/dev/null" }
        ]
      }
    ]
  }
}
```

## 配置文件位置

钩子配置使用项目根目录文件，并按从低到高的优先级合并：

1. 项目共享配置（`settings.json`）
2. 项目本地配置（`settings.local.json`）— 被 gitignore，用于个人覆盖

**技能钩子**：技能可以定义自己的钩子配置，由 Skills 系统管理。详见 [06-技能系统](./06-skills.md) 的「技能钩子」章节。

---

> [← 上一篇: 工具](./03-tools.md) | [目录](./README.md) | [下一篇: 记忆系统 →](./05-memory-system.md)
