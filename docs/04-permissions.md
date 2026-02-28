# 权限引擎

> [← 上一篇: 工具](./03-tools.md) | [目录](./README.md) | [下一篇: 生命周期钩子 →](./05-hooks.md)

CodeTerm 使用分层权限引擎来控制 AI 代理可以执行哪些工具调用。该引擎在安全性（防止破坏性操作）和易用性（不中断低风险读取操作）之间取得平衡。每次工具调用在执行前都会经过 `PermissionManager.check()` 检查。

**源文件：**
- `src/permissions/manager.ts` — 核心引擎、模式逻辑、规则存储
- `src/permissions/matcher.ts` — 基于 glob 的规则匹配，含防链式调用保护
- `src/tui/PermissionDialog.tsx` — 交互式审批 UI

---

## 权限模式

CodeTerm 支持五种权限模式。可通过 CLI 标志、配置文件或运行时设置模式。

| 模式 | 行为 |
|------|----------|
| `default` | 自动允许只读工具（Read、Glob、Grep）。其他操作需询问用户。 |
| `acceptEdits` | 自动允许只读工具**和** Write/Edit。Bash 及其他工具需询问。 |
| `plan` | 仅允许只读访问。Bash 会触发提示。Write/Edit 直接拒绝。 |
| `dontAsk` | 从不提示用户。未被显式 `allow` 规则覆盖的工具将被拒绝。 |
| `bypassPermissions` | 允许所有操作，无需任何提示。请谨慎使用。 |

### 模式选择优先级

1. CLI 标志 `--dangerously-skip-permissions` 强制使用 `bypassPermissions`
2. CLI 标志 `--permission-mode <mode>` 显式设置模式
3. `settings.local.json` 中的 `permissions.defaultMode` 字段提供项目默认值
4. 回退到 `default`

### 各模式适用场景

- **default** — 交互式开发，大多数会话的安全选择
- **acceptEdits** — 当你信任代理修改文件但希望审批 shell 命令时使用
- **plan** — 仅审查的会话，用于浏览代码而无变更风险
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

工具名支持单词字符和连字符：`[\w-]+`。括号内的 pattern 是标准 glob（由 `minimatch` 提供支持，启用 `dot: true`）。

### 如何提取 specifier

每种工具类型将其参数映射为用于匹配的 "specifier" 字符串：

| 工具 | Specifier 来源 |
|------|-----------------|
| `Bash` | `args.command` |
| `Read`、`Write`、`Edit` | `args.file_path`（或 `args.filePath`） |
| `Grep` | `args.pattern` |
| `Glob` | `args.pattern` |
| 其他 | `JSON.stringify(args)` |

---

## 求值顺序

当调用 `PermissionManager.check(toolName, args)` 时，规则按严格顺序求值。第一个匹配的规则胜出。

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
| `Bash: git status` | 允许 | 匹配 `allow` 规则 `Bash(git *)` |
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

但关键点在于，deny 列表中的 `Bash(rm *)` 这样的规则**不会**捕获隐藏在已允许命令链式操作符之后的 `rm`。防护机制的工作方向相反：`npm run *` 的 allow 规则不能被滥用来偷偷执行破坏性命令，因为 allow 规则只看到 `npm run build`。链式的 `rm -rf /` 部分没有匹配的 allow 规则，会回退到默认行为（在 default 模式下为"询问"）。

识别的边界标记：`&&`、`||`、`;`、`|`

---

## 会话规则与持久化规则

当用户批准工具调用时，其选择决定了规则持续多长时间：

### 会话临时规则（`allow_session` / S 键）

- 存储在 `PermissionManager.sessionAllows`（内存数组）中
- 会话结束时清除（`clearSession()`）
- 适用于编码会话期间的一次性批准
- 示例：在当前会话中批准 `Bash(npm test *)`

### 持久化规则（`always_allow` / A 键）

- 立即添加到 `PermissionManager.rules.allow`
- 会话结束时持久化到 `.codeterm/settings.local.json`
- 应用重启后仍然有效
- 与现有规则合并（去重）

### 配置文件格式

```json
// .codeterm/settings.local.json
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

当用户按下 **A**（always_allow）或 **S**（allow_session）时，引擎通过 `PermissionManager.generateRule()` 从当前工具调用自动生成规则：

| 工具 | 生成的规则模式 |
|------|----------------------|
| `Bash` 执行 `npm run build` | `Bash(npm run *)` — 保留前两个 token + 通配符 |
| `Bash` 执行 `git`（单个 token） | `Bash(git *)` |
| `Bash` 无命令 | `Bash(*)` |
| `Edit` 操作 `src/foo.ts` | `Edit(src/foo.ts)` — 精确文件路径 |
| `Write` 操作 `docs/readme.md` | `Write(docs/readme.md)` — 精确文件路径 |
| 其他任意工具 | `ToolName(*)` — 通配符匹配 |

生成的规则有意比单个精确匹配更宽泛（例如 `Bash(npm run *)` 而非 `Bash(npm run build)`），以减少对类似命令的重复提示。

---

## 权限对话框 UI

当工具调用需要用户批准（`check()` 返回 `"ask"`）时，TUI 渲染一个内联的 `PermissionDialog` 组件。

### 布局

```
╭──────────────────────────────────────────────────────────╮
│ ⚡ Bash: npm run build                                   │
│ Allow?  [Y] Yes  [N] No  [A] Always  [S] Session  [Esc] │
╰──────────────────────────────────────────────────────────╯
```

对于 Edit/Write 工具，会显示紧凑的 diff 预览：

```
╭──────────────────────────────────────────────────────────╮
│ ⚡ Edit: src/config.ts                                   │
│   - const timeout = 5000;                                │
│   + const timeout = 10000;                               │
│ Allow?  [Y] Yes  [N] No  [A] Always  [S] Session  [Esc] │
╰──────────────────────────────────────────────────────────╯
```

### 键盘快捷键

| 按键 | 选择 | 效果 |
|-----|--------|--------|
| `Y` | `allow_once` | 仅允许此次调用 |
| `N` | `deny` | 拒绝此次调用 |
| `A` | `always_allow` | 允许并添加持久化规则到配置 |
| `S` | `allow_session` | 允许并添加会话临时规则 |
| `Esc` | `deny` | 同 N |
| `Tab` / 方向键 | — | 在按钮间导航 |
| `Enter` | — | 提交当前聚焦的按钮 |

### 200ms 防抖

对话框出现后的前 200ms 内忽略所有按键。这可以防止用户正在输入时权限提示突然出现导致的误操作。

---

## 子代理权限继承

当生成子代理时，它会继承父代理的权限规则和模式，并根据代理类型进行修改。

### 继承规则

1. **权限规则被复制** — 父代理的 `allow`、`deny` 和 `ask` 数组会展开到子代理的配置中
2. **bypassPermissions 模式继承** — 如果父代理运行在 bypass 模式，子代理也是如此
3. **只读代理获得额外 deny 规则** — Explore 和 Plan 子代理会在继承规则之上收到额外的破坏性操作 deny 规则

### 只读代理 deny 列表

`Explore` 或 `Plan` 类型的子代理会在继承规则之上自动收到以下 deny 规则：

```
Write(*)
Edit(*)
Bash(rm *)       Bash(mv *)        Bash(cp *)
Bash(chmod *)    Bash(chown *)     Bash(mkdir *)
Bash(rmdir *)    Bash(touch *)     Bash(git push*)
Bash(git reset*) Bash(git checkout -- *)
Bash(npm publish*)  Bash(npx *)
```

### 子代理中无交互式对话框

子代理无法显示权限对话框 —— 它们以非交互方式运行。当子代理的工具调用触发 `permission_request` 事件时，会被**自动拒绝**：

```typescript
case "permission_request":
  // 子代理无法显示交互式对话框 — 自动拒绝
  event.resolve("deny");
  break;
```

这意味着子代理只能使用被继承的 allow 规则或只读豁免覆盖的工具。任何在父代理中需要用户批准的工具，在子代理中都会被静默拒绝。

### 自定义代理限制

在 `.codeterm/agents/` 中定义的自定义代理可以在其 frontmatter 中指定 `disallowedTools`。每个不允许的工具会作为 deny 规则（`ToolName(*)`）添加到子代理的权限集中。

---

## 配置参考

### CLI 标志

```bash
# 设置权限模式
codeterm --permission-mode acceptEdits

# 跳过所有权限检查（危险）
codeterm --dangerously-skip-permissions
```

### 配置文件

```json
// .codeterm/settings.local.json
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
- deny 规则始终优先于 allow 规则 —— 用它们作为安全护栏
- `ask` 数组即使在 allow 规则匹配时也会强制提示 —— 适用于需要逐案审查的高风险命令
- 会话规则与持久化规则一起检查 —— 两者都贡献到 allow 集合中
