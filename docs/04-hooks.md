# 生命周期钩子

> [← 上一篇: 工具](./03-tools.md) | [目录](./README.md) | [下一篇: 记忆与上下文 →](./05-memory-system.md)

## 概述

钩子（Hooks）允许你在代理生命周期事件发生时运行自定义操作。它们在 `settings.json` 中配置，并遵循 Claude Code 兼容的约定。

使用钩子来执行项目策略、转换工具输入、记录活动、触发外部工作流或阻止不安全操作 —— 所有这些都无需修改代理核心代码。

## 本章怎么读（教程模式）

### 你会学到什么

- Hook 的事件模型、执行模型和退出码语义。
- 为什么 `PreToolUse` 是策略硬约束的首选位置。
- hooks 与 permissions、skills 的责任边界。

### 建议阅读方式

1. 先读「Hook 与 Permission 一体化策略」建立顺序认知。
2. 再读「钩子事件 + 配置 + 执行模型」掌握原语。
3. 最后读「实践示例」验证 deny/modify/log 三类典型模式。

### 完成标志

- 你能独立写出一个可拒绝、可改写输入的 `PreToolUse` hook。
- 你能说明何时该用 hook，何时该用 permission 规则。

### 最小实操

1. 配置一个 `PreToolUse` 的 Bash matcher，在命中危险命令时 `exit 2`。
2. 再配置一个返回 `{"action":"modify"}` 的钩子，验证输入改写是否生效。
3. 最后补一个 `PostToolUse` 日志钩子，观察完整 pre/post 链路。

### 常见误区

- 在钩子里承载“用户授权”逻辑，导致职责混乱。
- 忽略退出码语义，导致预期拒绝却被当作普通错误继续执行。

### 排错清单（症状 -> 排查顺序）

| 症状 | 排查顺序 |
|------|----------|
| 钩子脚本执行了但未阻断 | 检查退出码是否为 `2` -> 检查 stderr/JSON deny 格式 |
| 输入改写不生效 | 检查 stdout JSON 是否合法 -> 检查 `modifiedInput` 字段名 |
| 多个钩子执行顺序异常 | 检查 matcher 命中范围 -> 检查配置合并顺序 -> 检查首拒绝短路 |

## 主轴定位（Agent Loop + Hooks）

在 Codara 的文档主线上，`hooks` 是 `agent loop` 之后的第一扩展面。  
`permissions`、`security-check`、`audit-logger`、协作策略等能力，推荐都通过 skills 在 hooks 之上编排，而不是继续扩展核心硬编码分支。

## 本文与 06/05 的关系

- 本文（04）定义 **Hooks 原语**：事件、动作类型、执行模型、退出码。
- [06-skills](./06-skills.md) 定义 **能力编排**：如何用 skill 组合 hooks + permissions。
- [appendix/permissions](./appendix/permissions.md) 是附录速查：仅保留权限策略细节，不作为独立主线。

建议阅读顺序：`02-agent-loop → 04-hooks → 05-memory-system → 06-skills`（需要规则细节时再查附录）。

> **💡 使用建议**
>
> 本文档是钩子机制的**参考手册**，描述底层工作原理。
>
> **推荐做法**：不要直接在 `settings.json` 中配置 hooks，而是通过 **[Skills](./06-skills.md)** 封装钩子逻辑。
>
> Skills 提供：
> - ✅ 自包含的目录结构（脚本、配置集中管理）
> - ✅ 场景化启用（通过 skill 组织策略，避免全局散落配置）
> - ✅ 可复用和分享（打包整个 skill 目录）
> - ✅ 清晰的文档和示例
>
> 参见 [06-技能系统](./06-skills.md) 的「实战：如何构造 Skills」章节，了解如何通过 Skills 使用 Hooks。

## Hook 与 Permission 一体化策略

在运行时，`permissions` 不是和 hooks 并列的“独立产品入口”，而是工具调用链中的策略层：

```
PreToolUse Hooks → Permission 求值 → Tool 执行 → PostToolUse Hooks
```

这条链路决定了职责边界：
- **Hooks**：先拦截、可拒绝、可改写输入（硬策略）。
- **Permissions**：用户授权与规则求值（交互策略）。
- **Skills**：把 hooks + permissions 组合成可复用能力（业务策略）。

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
          { "type": "command", "command": "osascript -e 'display notification \"Codara session started\" with title \"Codara\"'" }
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

> [← 上一篇: 工具](./03-tools.md) | [目录](./README.md) | [下一篇: 记忆与上下文 →](./05-memory-system.md)
