# 权限策略（并入 Hooks / Skills）

`permissions` 在 Codara 中是工具调用链中的策略步骤，不建议再作为独立长文维护。

主参考请看：
- `../../hooks/references/hooks-complete.md`（Hook + Permission 一体化）
- `../../../../docs/04-hooks.md`（运行时机制）
- `../../../../docs/06-skills.md`（如何 skill 化组合）

## 一句话边界

- `PreToolUse hooks`：先拦截，可 deny/modify
- `permissions`：做规则求值和授权交互
- `skills`：场景化组合与复用

## 最小速查

### 模式

| 模式 | 行为 |
|------|------|
| `default` | 自动允许 Read/Glob/Grep，其余询问 |
| `acceptEdits` | 自动允许只读 + Write/Edit |
| `plan` | 仅只读自动允许 |
| `dontAsk` | 不询问，未 allow 即拒绝 |
| `bypassPermissions` | 全放行（高风险） |

### 规则语法

- 基本格式：`ToolName(pattern)`
- 示例：`Bash(git *)`、`Edit(src/**)`、`Write(docs/*.md)`
- 优先级：`deny` > `ask` > `allow`

## 迁移原则

1. 不新增“纯 permissions 流程文档”。
2. 把项目策略封装到 skills（`allowed-tools` + hooks + scripts）。
3. `settings.json/settings.local.json` 仅保留稳定默认规则。
