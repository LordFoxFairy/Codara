# 权限引擎

> [← 上一篇: 工具](./03-tools.md) | [目录](./README.md) | [下一篇: 生命周期钩子 →](./04-hooks.md)

Codara 使用分层权限引擎来控制代理可以执行哪些工具调用。该引擎在安全性（防止破坏性操作）和易用性（不中断低风险读取操作）之间取得平衡。权限检查作为 **PermissionMiddleware** 运行在 wrapToolCall 洋葱层中（priority: 10），是工具调用穿过的第一道关卡。

> **💡 使用建议**
>
> 本文档是权限机制的**参考手册**，描述底层工作原理。
>
> **推荐做法**：不要直接在 `settings.json` 中配置全局 permissions，而是通过 **[Skills](./06-skills.md)** 的 `allowed-tools` 临时授权。
>
> Skills 提供：
> - ✅ 临时授权（技能执行期间生效，完成后自动撤销）
> - ✅ 作用域清晰（只影响当前技能，不影响其他会话）
> - ✅ 减少提示（技能内部操作无需反复确认）
> - ✅ 安全可控（用户的 deny 规则仍然优先）
>
> 参见 [06-技能系统 > 技能权限](./06-skills.md#技能权限) 了解如何通过 Skills 使用 Permissions。

---

## 权限模式

Codara 支持五种权限模式。可通过 CLI 标志、配置文件或运行时设置。

| 模式 | 行为 |
|------|----------|
| `default` | 自动允许只读工具（Read、Glob、Grep）。其他操作需询问用户。 |
| `acceptEdits` | 自动允许只读工具**和** Write/Edit。Bash 及其他工具需询问。 |
| `plan` | 仅允许只读访问。Bash 会触发提示。Write/Edit 直接拒绝。 |
| `dontAsk` | 从不提示用户。未被显式 `allow` 规则覆盖的工具将被拒绝。 |
| `bypassPermissions` | 允许所有操作，无需任何提示。请谨慎使用。 |

### 模式选择优先级

1. CLI 标志 `--dangerously-skip-permissions` → 强制 `bypassPermissions`
2. CLI 标志 `--permission-mode <mode>` → 显式设置
3. `settings.local.json` 中的 `permissions.defaultMode` → 项目默认值
4. 回退到 `default`

### 各模式适用场景

- **default** — 交互式开发，大多数会话的安全选择
- **acceptEdits** — 信任代理修改文件但希望审批 shell 命令
- **plan** — 仅审查的会话，浏览代码无变更风险
- **dontAsk** — CI/自动化场景，没有人可以响应提示
- **bypassPermissions** — 完全信任代理时的快速原型开发（不建议用于生产环境）

---

## 规则语法

权限规则遵循 `ToolName(pattern)` 格式，其中 `pattern` 是与工具主要参数匹配的 glob 模式。

### 基本形式

```
Bash(*)            # 匹配所有 Bash 调用
Bash(git *)        # 匹配以 "git" 开头的 Bash 命令
Bash(npm run *)    # 匹配 "npm run build"、"npm run test" 等
Edit(src/**)       # 匹配 src/ 下任意文件的 Edit 调用
Write(docs/*.md)   # 匹配 docs/ 中 markdown 文件的 Write 调用
Read(*.json)       # 匹配 JSON 文件的 Read 调用
Grep(*)            # 匹配所有 Grep 调用
```

### 仅工具名形式

```
Bash               # 等同于 Bash(*) — 匹配所有 Bash 调用
```

### 通配符工具匹配

```
mcp__*             # 匹配所有 MCP 工具调用（任意 provider）
```

工具名支持单词字符和连字符：`[\w-]+`。括号内的 pattern 是标准 glob（由 minimatch 提供支持，启用 `dot: true`）。

### Specifier 提取

每种工具类型将其参数映射为用于匹配的 specifier 字符串：

| 工具 | Specifier 来源 |
|------|-----------------|
| `Bash` | `command` 参数 |
| `Read`、`Write`、`Edit` | `file_path` 参数 |
| `Grep` | `pattern` 参数 |
| `Glob` | `pattern` 参数 |
| 其他 | 参数的 JSON 序列化 |

---

## 求值顺序

当 PermissionMiddleware 检查工具调用时，规则按严格顺序求值。第一个匹配的规则胜出。

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

> **业界对比 — Claude Code 的权限求值链：** Claude Code 采用 4 步求值（非中间件），作为参考：
>
> | 步骤 | 机制 | 说明 |
> |------|------|------|
> | 1. Hooks | `PreToolUse` 钩子 | Shell 命令可返回 deny/modify，最先执行 |
> | 2. Rules | `permissions.allow/deny` 规则 | glob 匹配，3 级（allow/ask/deny） |
> | 3. Mode | 权限模式 | bypassPermissions / acceptEdits / plan 等 |
> | 4. Callback | `canUseTool` 回调 | 兜底的程序化判断 |
>
> Codara 的 9 步求值链更细粒度（区分 ask 强制提示、只读豁免、模式感知兜底），且通过中间件管道统一执行，而非分散在钩子和回调中。

### 示例

给定以下规则：

```json
{
  "allow": ["Bash(git *)"],
  "deny": ["Bash(git push*)"],
  "ask": ["Bash(git reset*)"]
}
```

| 工具调用 | 结果 | 原因 |
|-----------|--------|-----|
| `Bash: git status` | 允许 | 匹配 `allow` 规则 |
| `Bash: git push origin main` | 拒绝 | 匹配 `deny` 规则（在 allow 之前检查） |
| `Bash: git reset --hard` | 询问 | 匹配 `ask` 规则（在 allow 之前检查） |
| `Read: src/index.ts` | 允许 | 只读工具豁免 |
| `Bash: rm -rf /tmp` | 询问 | 无规则匹配，回退到默认行为 |

---

## Bash 命令提取（防链式调用）

匹配器包含对 shell 命令链式攻击的防护。在评估 Bash 规则时，只匹配**第一个命令段** —— `&&`、`||`、`;` 或 `|` 之后的内容都会被忽略。

```
规则:    Bash(npm run *)
命令:    npm run build && rm -rf /
匹配的: "npm run build"  ← 只检查这部分
结果:    允许（匹配规则）
```

关键点：deny 列表中的规则**不会**捕获隐藏在允许命令链式操作符之后的破坏性命令。allow 规则只看到第一段。链式的后续部分没有匹配的 allow 规则，会回退到默认行为（在 default 模式下为"询问"）。

识别的边界标记：`&&`、`||`、`;`、`|`

---

## 会话规则与持久化规则

当用户批准工具调用时，其选择决定了规则持续多长时间：

### 会话临时规则（S 键）

- 存储在 PermissionMiddleware 内存中
- 会话结束时清除
- 适用于编码会话期间的一次性批准

### 持久化规则（A 键）

- 立即添加到权限规则集
- 会话结束时持久化到 `.codara/settings.local.json`
- 应用重启后仍然有效
- 与现有规则合并（去重）

### 配置文件格式

```json
{
  "permissions": {
    "allow": ["Bash(git *)", "Edit(src/**)"],
    "deny": ["Bash(rm *)"],
    "ask": ["Bash(npm publish*)"],
    "defaultMode": "default"
  }
}
```

多个配置文件会被加载并合并（项目级和用户级），所有 `allow`、`deny` 和 `ask` 数组会被拼接。

---

## 自动生成规则

当用户按下 **A**（always\_allow）或 **S**（allow\_session）时，引擎从当前工具调用自动生成规则：

| 工具 | 生成的规则模式 |
|------|----------------------|
| Bash 执行 `npm run build` | `Bash(npm run *)` — 保留前两个 token + 通配符 |
| Bash 执行 `git`（单个 token） | `Bash(git *)` |
| Bash 无命令 | `Bash(*)` |
| Edit 操作 `src/foo.ts` | `Edit(src/foo.ts)` — 精确文件路径 |
| Write 操作 `docs/readme.md` | `Write(docs/readme.md)` — 精确文件路径 |
| 其他任意工具 | `ToolName(*)` — 通配符匹配 |

生成的规则有意比单个精确匹配更宽泛，以减少对类似命令的重复提示。

---

## 权限交互

当工具调用需要用户审批时，权限引擎 yield 一个 `permission_request` 事件（含 `resolve` 回调），TUI 渲染权限对话框，用户决策后调用 `resolve()` 返回结果。这种事件回调模式与 Claude Code 一致——权限交互不依赖中间件，而是通过 Agent 事件流与 TUI 双向通信。

用户可选择四种响应：`allow_once`（Y）、`deny`（N）、`always_allow`（A）、`allow_session`（S）。

权限对话框的完整视觉规范（布局、快捷键、防抖、diff 预览等）详见 [09-终端界面](./09-terminal-ui.md) 的 PermissionDialog 章节。

---

## 从代理权限继承

当主 Agent 生成从代理时，从代理继承主 Agent 的权限规则和模式。

### 继承规则

1. **权限规则被复制** — 主 Agent 的 `allow`、`deny` 和 `ask` 数组展开到从代理的配置中
2. **bypassPermissions 模式继承** — 如果主 Agent 运行在 bypass 模式，从代理也是如此
3. **只读代理获得额外 deny 规则** — Explore 和 Plan 从代理在继承规则之上收到额外的破坏性操作 deny 规则

### 从代理的权限交互

从代理不直接拥有 TUI，但其权限请求**通过主 Agent 的交互基础设施处理**。当从代理的工具调用触发权限检查（结果为"ask"）时，权限对话框在主 Agent 的 TUI 中显示，用户审批结果返回给从代理。这与 Claude Code 的行为一致。

### 自定义代理限制

在 `.codara/agents/` 中定义的自定义代理可以在其 frontmatter 中指定 `disallowedTools`。每个不允许的工具以 `ToolName(*)` 形式添加到 deny 规则中。

---

## 配置参考

### CLI 标志

```bash
# 设置权限模式
codara --permission-mode acceptEdits

# 跳过所有权限检查（危险）
codara --dangerously-skip-permissions
```

### 配置文件

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

### 规则编写提示

- 使用 `**` 进行递归目录匹配：`Edit(src/**)` 匹配 `src/a/b/c.ts`
- 使用 `*` 进行单层匹配：`Edit(src/*.ts)` 匹配 `src/index.ts` 但不匹配 `src/utils/helper.ts`
- deny 规则始终优先于 allow 规则——用它们作为安全护栏
- `ask` 数组即使在 allow 规则匹配时也会强制提示——适用于需要逐案审查的高风险命令
- 会话规则与持久化规则一起检查——两者都贡献到 allow 集合中

---

> [← 上一篇: 工具](./03-tools.md) | [目录](./README.md) | [下一篇: 生命周期钩子 →](./04-hooks.md)
