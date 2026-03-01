---
name: hooks-guide
description: 查看生命周期钩子完整文档
argument-hint: "[event-name]"
user-invocable: true
disable-model-invocation: true
---

# 生命周期钩子参考

> **💡 使用建议**
>
> 本文档是钩子机制的**参考手册**，描述底层工作原理。
>
> **推荐做法**：不要直接在 `settings.json` 中配置 hooks，而是通过 **Skills** 封装钩子逻辑。
>
> 参见 `/skills-guide` 了解如何通过 Skills 使用 Hooks。

---

## 快速查询

调用方式：
- `/hooks-guide` - 查看完整文档
- `/hooks-guide PreToolUse` - 查看特定事件（未来支持）

---

## 16 个钩子事件

### 会话生命周期
- `SessionStart` - 新的代理会话开始时
- `SessionEnd` - 会话结束时（正常完成、错误或中断）

### 用户输入
- `UserPromptSubmit` - 用户提交提示词后，代理处理之前

### 工具生命周期
- `PreToolUse` - 工具执行之前。可以**修改输入**或**拒绝**执行
- `PostToolUse` - 工具成功执行之后
- `PostToolUseFailure` - 工具执行失败之后

### 代理控制
- `Stop` - 代理循环即将停止时。拒绝此事件可强制代理继续运行
- `PermissionRequest` - 工具调用触发权限对话框时

### 子代理生命周期
- `SubagentStart` - 子代理被生成时
- `SubagentStop` - 子代理完成时

### 上下文管理
- `PreCompact` - 上下文压缩运行之前（上下文窗口接近限制时）

### 任务与通知
- `TaskCompleted` - 后台任务完成时
- `Notification` - 发出通用通知时

### 配置与工作树
- `ConfigChange` - 配置文件被修改时
- `WorktreeCreate` - git worktree 被创建时
- `WorktreeRemove` - git worktree 被移除时

---

## 配置语法

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

### 钩子类型

| 类型 | 描述 | 用途 |
|------|------|------|
| `command` | 执行 shell 命令 | 脚本验证、日志记录、阻止操作 |
| `http` | 发送 POST 到指定 URL | 外部 webhook、远程审计 |
| `prompt` | 将文本注入对话上下文 | 动态提示注入、上下文增强 |
| `agent` | 生成子代理处理事件 | 复杂的事件响应逻辑 |

---

## 退出码约定

| 退出码 | 含义 | 行为 |
|--------|------|------|
| **0** | 批准 | 继续执行。stdout 可包含 JSON 操作 |
| **2** | 拒绝/阻止 | 工具执行被阻止。stderr 用作拒绝原因 |
| **其他** | 批准（带警告） | 继续执行。stderr 作为警告记录 |

---

## PreToolUse 操作

### 拒绝操作

```json
{"action": "deny", "reason": "This operation is not permitted"}
```

### 修改操作

```json
{"action": "modify", "modifiedInput": {"command": "echo 'sanitized command'"}}
```

---

## 环境变量

| 变量 | 描述 |
|------|------|
| `HOOK_EVENT` | 事件名称（例如 `PreToolUse`、`SessionStart`） |
| `TOOL_NAME` | 被调用的工具（非工具事件时为空） |
| `TOOL_INPUT` | JSON 编码的工具输入参数 |
| `SESSION_ID` | 当前会话标识符 |
| `CWD` | 代理的工作目录 |
| `TOOL_OUTPUT` | 工具输出（仅 `PostToolUse` 时设置） |
| `TOOL_ERROR` | 工具错误信息（仅 `PostToolUseFailure` 时设置） |

---

## 实战示例

参见 `/skills-guide` 了解如何通过 Skills 使用 Hooks：
- 安全检查技能（阻止危险命令）
- 审计日志技能（记录所有工具调用）
- 沙箱技能（重定向文件写入）

---

## 完整文档

详细的钩子事件、配置语法、执行模型、退出码约定等，请参阅：
`docs/04-hooks.md`

或在线查看：
https://github.com/your-org/codara/blob/main/docs/04-hooks.md

---

**记住：通过 Skills 封装 Hooks，而非直接配置 settings.json。**
