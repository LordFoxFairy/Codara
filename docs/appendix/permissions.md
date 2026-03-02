# 权限策略（附录）

> [← 回到主线: 生命周期钩子](../04-hooks.md) | [目录](../README.md) | [前往主线: 技能系统 →](../06-skills.md)

本文是权限策略速查页，不是独立主线。

Codara 的设计主轴是 `agent loop + hooks`，权限是该链路中的策略步骤：

```
PreToolUse Hooks → Permission 求值 → Tool 执行 → PostToolUse Hooks
```

项目策略（例如 `permissions`、`security-check`）应优先通过 skills 封装，而不是长期手写大段全局配置。

## 最小速查

### 模式

| 模式 | 行为 |
|------|------|
| `default` | 自动允许 Read/Glob/Grep，其他询问 |
| `acceptEdits` | 自动允许只读 + Write/Edit |
| `plan` | 仅只读自动允许 |
| `dontAsk` | 不询问，未 allow 即拒绝 |
| `bypassPermissions` | 全放行（高风险） |

### 规则

- 语法：`ToolName(pattern)`
- 示例：`Bash(git *)`、`Edit(src/**)`、`Write(docs/*.md)`
- 优先级：`deny > ask > allow`

### 与 skills 的关系

- `allowed-tools` 会在技能执行期间注入临时 `allow` 规则。
- 技能结束后临时规则自动撤销。
- 用户 `deny` 规则始终优先，skills 不能绕过。

需要完整机制请看 [04-hooks](../04-hooks.md)，需要编排实践请看 [06-skills](../06-skills.md)。
