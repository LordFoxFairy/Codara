# 生命周期钩子

> [← 上一篇: 权限引擎](./05-permissions.md) | [目录](./README.md) | [下一篇: 技能系统 →](./06-skills.md)

## 概述

钩子（Hooks）允许你在代理生命周期事件发生时运行自定义 shell 命令。它们在 `settings.json` 中配置，并遵循 Claude Code 兼容的约定。

使用钩子来执行项目策略、转换工具输入、记录活动、触发外部工作流或阻止不安全操作 —— 所有这些都无需修改代理核心代码。

## 钩子事件

CodeTerm 支持 16 个生命周期事件。每个事件在代理执行的特定时刻触发，并接收与该时刻相关的上下文数据。

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
- **`hooks`** — 匹配器匹配时执行的操作数组。每个操作的 `type` 为 `"command"`，并包含一个 `command` 字符串。

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
          { "type": "command", "command": "echo \"$(date -Iseconds) $TOOL_NAME\" >> /tmp/codeterm-tool-log.txt" }
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
          { "type": "command", "command": "osascript -e 'display notification \"CodeTerm session started\" with title \"CodeTerm\"'" }
        ]
      }
    ]
  }
}
```

## 配置文件位置

钩子可以在多个位置定义。配置按从低到高的优先级合并：

1. 全局配置（`~/.codara/settings.json`）
2. 项目配置（项目根目录的 `.codara/settings.json`）
3. 技能钩子（`.codara/skills/*/hooks/hooks.json` 和 `~/.codara/skills/*/hooks/hooks.json`）

### 技能钩子发现

ShellHookMiddleware 在启动时扫描所有技能目录，加载技能钩子配置：

```
.codara/skills/{skill-name}/hooks/hooks.json
~/.codara/skills/{skill-name}/hooks/hooks.json
```

技能钩子格式与 `settings.json` 中的 hooks 相同。所有钩子按优先级合并，同一事件的钩子按顺序执行。

#### 技能钩子路径变量

技能钩子中的命令可以使用 `${CODARA_SKILL_ROOT}` 变量引用技能根目录：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CODARA_SKILL_ROOT}/scripts/validate.sh $TOOL_INPUT"
          }
        ]
      }
    ]
  }
}
```

执行时，`${CODARA_SKILL_ROOT}` 会被替换为技能的绝对路径（例如 `.codara/skills/code-review`）。

#### 合并顺序

钩子按以下顺序合并和执行：

1. `settings.json` 中的 hooks（用户全局 + 项目级）
2. 项目技能钩子（`.codara/skills/*/hooks/hooks.json`）
3. 用户技能钩子（`~/.codara/skills/*/hooks/hooks.json`）

同一事件的多个钩子按注册顺序依次执行。

---
