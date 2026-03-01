---
name: permissions-guide
description: 查看权限引擎完整文档
argument-hint: "[mode-name]"
user-invocable: true
disable-model-invocation: true
---

# 权限引擎参考

> **💡 使用建议**
>
> 本文档是权限机制的**参考手册**，描述底层工作原理。
>
> **推荐做法**：不要直接在 `settings.json` 中配置全局 permissions，而是通过 **Skills** 的 `allowed-tools` 临时授权。
>
> 参见 `/skills-guide` 了解如何通过 Skills 使用 Permissions。

---

## 快速查询

调用方式：
- `/permissions-guide` - 查看完整文档
- `/permissions-guide default` - 查看特定模式（未来支持）

---

## 5 种权限模式

| 模式 | 行为 |
|------|------|
| `default` | 自动允许只读工具（Read、Glob、Grep）。其他操作需询问用户。 |
| `acceptEdits` | 自动允许只读工具**和** Write/Edit。Bash 及其他工具需询问。 |
| `plan` | 仅允许只读访问。Bash 会触发提示。Write/Edit 直接拒绝。 |
| `dontAsk` | 从不提示用户。未被显式 `allow` 规则覆盖的工具将被拒绝。 |
| `bypassPermissions` | 允许所有操作，无需任何提示。请谨慎使用。 |

---

## 规则语法

权限规则遵循 `ToolName(pattern)` 格式：

```
Bash(*)            # 匹配所有 Bash 调用
Bash(git *)        # 匹配以 "git" 开头的 Bash 命令
Bash(npm run *)    # 匹配 "npm run build"、"npm run test" 等
Edit(src/**)       # 匹配 src/ 下任意文件的 Edit 调用
Write(docs/*.md)   # 匹配 docs/ 中 markdown 文件的 Write 调用
Read(*.json)       # 匹配 JSON 文件的 Read 调用
```

---

## 9 步求值链

当 PermissionMiddleware 检查工具调用时，规则按严格顺序求值：

```
1. bypassPermissions 模式？  → 允许（跳过所有检查）
2. plan 模式？               → 允许 Read/Glob/Grep；Bash 需询问；其他拒绝
3. deny 规则匹配？           → 拒绝
4. ask 规则匹配？            → 询问（强制提示）
5. allow 规则匹配？          → 允许（包括会话临时规则）
6. 只读工具？                → 允许（Read、Glob、Grep 始终安全）
7. acceptEdits 模式？        → 允许 Write 和 Edit
8. dontAsk 模式？            → 拒绝（无法提示）
9. 兜底                      → 询问
```

**第一个匹配的规则胜出。**

---

## 配置示例

```json
{
  "permissions": {
    "defaultMode": "default",
    "allow": [
      "Bash(git *)",
      "Bash(npm run *)",
      "Edit(src/**)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force*)"
    ],
    "ask": [
      "Bash(npm publish*)"
    ]
  }
}
```

---

## 规则优先级

- **deny 规则始终优先于 allow 规则** — 用它们作为安全护栏
- **ask 规则即使在 allow 规则匹配时也会强制提示** — 适用于需要逐案审查的高风险命令
- 会话规则与持久化规则一起检查 — 两者都贡献到 allow 集合中

---

## 会话规则 vs 持久化规则

### 会话临时规则（S 键）
- 存储在 PermissionMiddleware 内存中
- 会话结束时清除
- 适用于编码会话期间的一次性批准

### 持久化规则（A 键）
- 立即添加到权限规则集
- 会话结束时持久化到 `.codara/settings.local.json`
- 应用重启后仍然有效

---

## 通过 Skills 使用权限

**推荐做法**：在 Skills 中使用 `allowed-tools` 临时授权

```markdown
---
name: commit
allowed-tools: "Bash(git *),Read(*),Grep(*)"
---

Analyze staged changes and create a commit.
```

**优势**：
- ✅ 临时授权（技能执行期间生效，完成后自动撤销）
- ✅ 作用域清晰（只影响当前技能，不影响其他会话）
- ✅ 减少提示（技能内部操作无需反复确认）
- ✅ 安全可控（用户的 deny 规则仍然优先）

---

## 实战示例

参见 `/skills-guide` 了解如何通过 Skills 使用 Permissions：
- 代码审查技能（只读访问 + 自动质量检查）
- 部署技能（临时授权 + Hook 验证）
- Git 工作流技能（组合权限控制）

---

## 完整文档

详细的权限模式、规则语法、求值顺序、Bash 命令提取等，请参阅：
`docs/05-permissions.md`

或在线查看：
https://github.com/your-org/codara/blob/main/docs/05-permissions.md

---

**记住：通过 Skills 的 allowed-tools 临时授权，而非直接配置全局 permissions。**
