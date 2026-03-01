# 技能系统

> [← 上一篇: 生命周期钩子](./04-hooks.md) | [目录](./README.md) | [下一篇: 代理协作 →](./07-agent-collaboration.md)

技能（Skills）是 Codara 的**统一扩展单元**，允许用户和项目定义可复用的 AI 驱动工作流。每个技能是一个目录，包含 SKILL.md 定义文件以及可选的 agents、hooks、scripts 等资源。用户通过在输入区域输入 `/<name>` 来调用技能。

核心理念：**核心通用（middleware + tools + TUI），领域扩展全靠 Skill**。code-review、feature-dev、commit 工作流等都是 skill，不是硬编码功能。

---

## 技能发现

SkillLoader 扫描两个目录树来查找技能定义：

| 优先级 | 路径 | 作用域 |
|----------|------|-------|
| 1（最高） | `.codara/skills/{name}/SKILL.md` | 项目级 |
| 2 | `~/.codara/skills/{name}/SKILL.md` | 用户级 |

每个技能位于 `skills/` 文件夹下的独立目录中。该目录必须包含一个 `SKILL.md` 文件。如果项目级技能与用户级技能同名，项目级技能优先。

### 技能目录结构

```
.codara/skills/{name}/
├── SKILL.md         # 必需：技能定义（YAML frontmatter + 提示模板）
├── agents/          # 可选：该技能相关的自定义代理定义
│   └── reviewer.md
├── scripts/         # 可选：可执行脚本
│   └── run.sh
├── hooks/           # 可选：该技能的钩子配置
│   └── hooks.json
├── references/      # 可选：参考文档
│   └── guide.md
└── assets/          # 可选：模板、资源文件
```

| 目录 | 用途 | 访问方式 |
|------|------|---------|
| `agents/` | 存放技能相关的自定义代理 | 通过 Task 工具调用，代理类型解析时发现 |
| `scripts/` | 存放技能相关的可执行脚本 | 通过 `` !`./scripts/run.sh` `` 动态注入 |
| `hooks/` | 存放技能的钩子配置 | 启动时加载，与 settings.json hooks 合并 |
| `references/` | 存放技能引用的文档 | 通过 `[label](./references/guide.md)` 文件链接内联 |
| `assets/` | 存放模板和资源文件 | 技能提示中引用，代理按需读取 |

### 缓存

发现结果缓存 60 秒。在此时间窗口内对 `discover()` 的后续调用会返回缓存列表，无需重新扫描文件系统。这使得会话期间的重复技能查找保持快速，同时仍能在合理时间内发现新技能。

### 解析

`SkillLoader.resolve(name)` 按名称查找技能。它在内部调用 `discover()` 并返回第一个匹配的 `SkillDefinition`，如果不存在该名称的技能则返回 `null`。

---

## SKILL.md 格式

技能文件是带有 YAML frontmatter（由 `---` 分隔）的标准 markdown 文档。frontmatter 定义元数据；正文是提示模板。

```markdown
---
name: commit
description: Auto-generate a commit message and create a git commit
argument-hint: "Optional: commit message override"
user-invocable: true
disable-model-invocation: false
context: inline
---

Analyze all staged changes (git diff --cached) and create a well-crafted commit message.

Steps:
1. Run `git status` and `git diff --cached` to understand staged changes
2. If $ARGUMENTS is provided, use it as the commit message directly
3. Create the commit with `git commit -m "..."`
```

---

## YAML Frontmatter 模式

| 字段 | 类型 | 默认值 | 描述 |
|-------|------|---------|-------------|
| `name` | `string` | 目录名 | 用于调用的技能名称（`/<name>`） |
| `description` | `string` | 正文第一段 | 在帮助和系统提示中显示的可读描述 |
| `argument-hint` | `string` | _(无)_ | 显示给用户的提示（例如 `"[message]"`、`"Optional: PR number"`） |
| `allowed-tools` | `string` | _(无)_ | 此技能的工具白名单，逗号分隔（例如 `"Bash(git *),Read(*),Grep(*)"`) |
| `hooks` | `object` | _(无)_ | 技能钩子配置（YAML 格式，与 hooks.json 结构相同） |
| `disable-model-invocation` | `boolean` | `false` | 如果为 `true`，展开后的提示直接返回而不调用 LLM |
| `user-invocable` | `boolean` | `true` | 如果为 `true`，技能出现在帮助中且可用 `/<name>` 调用 |
| `model` | `string` | _(无)_ | 此技能执行时的模型覆盖 |
| `context` | `"inline" \| "fork"` | `"inline"` | 执行上下文模式 |
| `agent` | `string` | _(无)_ | 用于执行的自定义代理类型 |

### 字段说明

- **`name`**：如果省略，默认为包含 `SKILL.md` 文件的目录名。
- **`description`**：如果省略，加载器会提取正文中第一个非标题、非空行（最多 120 个字符）。
- **`allowed-tools`**：通过逗号分割解析。这些在技能执行期间成为临时权限允许规则，授予 LLM 访问指定工具的权限而无需用户确认。支持 glob 模式，如 `Bash(git *)`。
- **`hooks`**：内联钩子配置，格式与 `hooks/hooks.json` 相同。与文件级钩子合并，优先级低于 `settings.json` 中的同名钩子。
- **`user-invocable`**：设置为 `user-invocable: false` 的技能仍然可以通过编程方式调用，但不会出现在帮助列表或系统提示中。

---

## 模板展开

当技能被调用时，`SkillExecutor.expand()` 按顺序通过三个展开阶段处理提示正文：

### 1. 参数替换

用户在技能名称之后输入的内容可通过以下变量获取：

| 变量 | 展开为 |
|----------|------------|
| `$ARGUMENTS` | 完整的原始参数字符串 |
| `$0`、`$1`、`$2`、... | 按空白字符分隔的单个参数 |
| `$ARGUMENTS[0]`、`$ARGUMENTS[1]`、... | 同 `$0`、`$1` 等 |

**示例：**

对于输入 `/deploy staging --force`：
- `$ARGUMENTS` = `staging --force`
- `$0` = `staging`
- `$1` = `--force`

如果技能正文不包含任何 `$ARGUMENTS` 引用且用户提供了参数，参数会自动追加到提示末尾，格式为 `ARGUMENTS: <value>`。

### 2. 动态上下文注入

用 `` !`command` `` 语法包裹的 shell 命令会在模板展开期间执行，并替换为其输出。

**语法：** `` !`command` ``

**示例：**
```markdown
Current git status:
!`git status --short`

Recent commits:
!`git log --oneline -5`
```

展开后，命令标记被替换为实际命令输出：
```markdown
Current git status:
M  src/app.ts
A  src/utils.ts

Recent commits:
ebc9d8f fix: model resolution
b0e001d fix: subagent routing
```

**执行细节：**
- 命令通过用户的 shell 运行（`$SHELL` 或 `/bin/sh`）
- 工作目录为技能的 `basePath`（包含 `SKILL.md` 的目录）
- 命令有 5 秒超时
- 如果命令失败，占位符被替换为 `(command failed: <command>)`

### 3. 文件链接解析

带有相对路径的 markdown 风格链接从技能目录解析，链接文件的内容被内联到提示中。

**语法：** `[label](relative/path.md)`

**示例：**
```markdown
Follow these guidelines:
[coding standards](./standards.md)
```

展开后，文件内容被注入到链接之后：
```markdown
Follow these guidelines:
[coding standards](./standards.md)

<file path="./standards.md">
... contents of standards.md ...
</file>
```

**解析规则：**
- 仅解析相对路径（以 `http` 开头的 URL 和以 `/` 开头的绝对路径保持不变）
- 路径相对于技能的 `basePath` 目录解析
- 出于安全考虑，阻止路径遍历到技能目录之外
- 如果文件不存在，链接保持不变

---

## 与 AgentLoop 的集成

`src/agent/loop.ts` 中的代理循环在两个点集成技能：初始化和输入处理。

### 系统提示注册

在 `AgentLoop.init()` 期间，所有发现的技能被加载，用户可调用的技能列在系统提示中：

```typescript
const skills = await this.skillLoader.discover();

// 添加到系统提示：
// # Available Skills
// - /commit: Auto-generate a commit message and create a git commit
// - /init: Generate a CODETERM.md configuration file
// - /review-pr: Review a pull request or current branch changes
```

这让 LLM 知道哪些技能存在，并在适当时建议使用它们。

### 输入拦截

当用户提交以 `/` 开头的输入时，代理循环在发送给 LLM 之前拦截它：

```
用户输入: /commit fix auth bug
              |         |
              v         v
         skillName   skillArgs
            |
            v
  skillLoader.resolve("commit")
            |
            v
  skillExecutor.expand(skill, "fix auth bug")
            |
            v
  SkillInvocation {
    expandedPrompt: "...",      // 完全展开的模板
    temporaryAllowRules: [...], // 工具权限
  }
```

**两条执行路径：**

1. **普通技能**（`disableModelInvocation: false`）：展开后的提示替换用户的输入，作为常规消息发送给 LLM。LLM 随后使用可用工具遵循技能的指令。

2. **直接技能**（`disableModelInvocation: true`）：展开后的提示直接作为输出文本发出，不调用 LLM。适用于只需要模板展开和命令输出的技能。

### 临时权限

当技能指定 `allowed-tools` 时，这些工具模式在技能执行期间作为临时允许规则添加到权限系统中：

```yaml
allowed-tools: "Bash(git *),Read(*),Grep(*)"
```

这授予 LLM 使用匹配工具的权限而无需用户确认，作用域限定在技能调用期间。

---

## 预配置技能

CodeTerm 在 `.codeterm/skills/` 中附带三个内置技能：

### /commit

使用 AI 生成的消息创建 git 提交。

```
/commit                    # 从暂存更改自动生成消息
/commit fix auth bug       # 直接使用提供的消息
```

**行为：**
1. 通过 `git diff --cached` 检查暂存的更改
2. 通过 `git log --oneline -5` 审查最近的提交风格
3. 以祈使语气起草简洁的提交消息
4. 如果提供了参数，直接使用它们作为消息
5. 创建提交并显示结果

**安全规则：** 永远不提交密钥（`.env`、凭证），永远不使用 `--no-verify` 或 `--no-gpg-sign`。

### /init

生成 `CODETERM.md` 项目配置文件。

```
/init                           # 自动检测项目设置
/init "React dashboard app"     # 提供项目描述
```

**行为：**
1. 分析项目结构（package.json、Cargo.toml、pyproject.toml、go.mod 等）
2. 读取现有的 README.md 获取上下文
3. 识别技术栈、构建命令、测试命令
4. 生成包含项目描述、命令、关键目录和编码规范的 CODETERM.md

### /review-pr

审查 Pull Request 或分支更改的质量。

```
/review-pr                # 审查当前分支与 main 的差异
/review-pr 42             # 审查 PR #42
```

**允许的工具：** `Bash(git *)`、`Bash(gh *)`、`Read(*)`、`Grep(*)`

**行为：**
1. 通过 `gh pr diff`（PR 编号）或 `git diff main...HEAD`（当前分支）获取 diff
2. 审查提交历史
3. 读取完整文件以获取每个更改的上下文
4. 检查 bug、安全问题、性能问题、风格一致性
5. 生成带有严重程度级别（critical / warning / suggestion）的结构化审查

---

## 创建自定义技能

要创建新技能：

1. 在 `.codeterm/skills/`（项目级）或 `~/.codeterm/skills/`（用户级）下创建目录：

```bash
mkdir -p .codeterm/skills/my-skill
```

2. 创建带有 frontmatter 和提示模板的 `SKILL.md` 文件：

```markdown
---
name: my-skill
description: Describe what this skill does
argument-hint: "[required-arg]"
user-invocable: true
---

Instructions for the LLM when this skill is invoked.

The user wants to: $ARGUMENTS

Current branch: !`git branch --show-current`
```

3. 技能立即可用（由于缓存可能需等待 60 秒，或在下次会话启动时生效）。使用 `/my-skill` 调用。

### 提示

- 保持技能提示专注于单一工作流
- 使用 `allowed-tools` 限制 LLM 在技能期间可以执行的操作，特别是对于不应修改文件的技能
- 对于只需运行命令并显示输出的技能，使用 `disable-model-invocation: true`
- 将补充文件（模板、检查列表）放在技能目录中，并通过文件链接引用
- 使用动态上下文（`` !`command` ``）将当前项目状态注入提示

---

## 技能权限

技能可以通过 `allowed-tools` 字段临时授予工具权限，减少执行期间的用户提示。这些临时权限在技能调用时激活，完成后自动撤销。

### allowed-tools 配置

在 SKILL.md 的 frontmatter 中指定允许的工具模式：

```markdown
---
name: commit
allowed-tools: "Bash(git *),Read(*),Grep(*)"
---

Analyze staged changes and create a commit.
```

**语法：** 逗号分隔的工具规则列表，每个规则遵循 `ToolName(pattern)` 格式（与权限规则相同）。

**示例：**

| 规则 | 匹配 |
|------|------|
| `Bash(git *)` | 所有 git 命令 |
| `Read(*)` | 读取任意文件 |
| `Edit(src/**)` | 编辑 src/ 下的文件 |
| `Bash(npm run *)` | npm run 命令 |

### 临时权限生命周期

1. **激活**：技能调用时，`allowed-tools` 解析为临时 allow 规则，添加到 PermissionMiddleware
2. **执行**：技能执行期间，这些规则参与权限求值（步骤 5，详见 [05-权限引擎](./05-permissions.md)）
3. **撤销**：技能完成后，临时规则自动移除

### deny 规则覆盖

**重要**：用户配置的 deny 规则优先于技能的临时 allow 规则。

```json
{
  "permissions": {
    "deny": ["Bash(git push*)"]
  }
}
```

即使技能声明 `allowed-tools: "Bash(git *)"`，`git push` 仍会被拒绝。这确保用户的安全策略不会被技能绕过。

### 权限模式和规则详解

技能的临时权限遵循完整的权限求值链。详细的权限模式、规则语法、求值顺序等，请参阅 [05-权限引擎](./05-permissions.md)。

---

## 技能钩子

技能可以定义自己的钩子配置，在技能执行期间响应生命周期事件。钩子可以通过两种方式定义：独立的 `hooks/hooks.json` 文件，或 SKILL.md 的 frontmatter 中的 `hooks` 字段。

### 技能钩子目录结构

```
.codara/skills/{name}/
├── SKILL.md
└── hooks/
    └── hooks.json    # 技能钩子配置
```

**hooks.json 格式：**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CODARA_SKILL_ROOT}/scripts/validate.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "echo \"Tool executed: $TOOL_NAME\" >> /tmp/skill-audit.log"
          }
        ]
      }
    ]
  }
}
```

### Frontmatter 中的 hooks 字段

SKILL.md 的 YAML frontmatter 支持内联 `hooks` 字段，无需额外的 `hooks.json` 文件：

```markdown
---
name: secure-deploy
description: 安全部署流程
allowed-tools: "Bash(npm run deploy*),Read(*)"
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bash ${CODARA_SKILL_ROOT}/scripts/security-check.sh"
---

Deploy the application to production.
```

**Frontmatter 钩子与文件级钩子合并**，优先级低于 `settings.json` 中的同名钩子。

### 技能钩子发现和加载

ShellHookMiddleware 在启动时扫描所有技能目录，加载技能钩子配置：

```
.codara/skills/{skill-name}/hooks/hooks.json
~/.codara/skills/{skill-name}/hooks/hooks.json
```

技能钩子格式与 `settings.json` 中的 hooks 相同。所有钩子按优先级合并，同一事件的钩子按顺序执行。

### ${CODARA_SKILL_ROOT} 变量

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

### 技能钩子与 settings.json 钩子的合并顺序

钩子按以下顺序合并和执行：

1. `settings.json` 中的 hooks（用户全局 + 项目级）
2. 项目技能钩子（`.codara/skills/*/hooks/hooks.json`）
3. 用户技能钩子（`~/.codara/skills/*/hooks/hooks.json`）

同一事件的多个钩子按注册顺序依次执行。

### 钩子事件和配置详解

技能钩子支持所有 16 个生命周期事件（PreToolUse、PostToolUse、SessionStart 等）。详细的钩子事件、配置语法、执行模型、退出码约定等，请参阅 [04-生命周期钩子](./04-hooks.md)。

---

## 工具调用完整流程

理解 Hooks、Permissions 和 Skills 如何协同工作，对于设计安全的技能至关重要。

### 流程图

当代理尝试调用工具时，请求按以下顺序通过多个检查点：

```
工具调用请求
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 1. PreToolUse Hooks (ShellHookMiddleware, priority: 55) │
│    - Shell 命令执行，可返回 deny/modify                   │
│    - 退出码 2 = 拒绝（短路，不继续）                       │
│    - 退出码 0 + JSON = 可修改 toolInput                   │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 2. PermissionMiddleware (priority: 50)                  │
│    - 按 9 步求值链检查权限                                │
│    - deny 规则 → 拒绝                                    │
│    - ask 规则 → 询问用户                                 │
│    - allow 规则（含技能临时规则）→ 放行                   │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 3. 工具执行                                              │
│    - 实际执行工具逻辑                                     │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 4. PostToolUse Hooks (ShellHookMiddleware, priority: 55)│
│    - 审计日志、通知等                                     │
└─────────────────────────────────────────────────────────┘
```

### 三者优先级

| 检查点 | 优先级 | 能力 | 典型用途 |
|--------|--------|------|----------|
| **PreToolUse Hooks** | 最高（先执行） | 拒绝、修改输入 | 策略强制、输入验证、危险命令拦截 |
| **PermissionMiddleware** | 中（Hooks 之后） | 拒绝、询问、允许 | 用户授权、安全边界、规则求值 |
| **Skills allowed-tools** | 低（作为 allow 规则） | 临时授予权限 | 减少技能执行期间的提示 |

### 设计建议

**何时使用 Hooks：**
- 需要在权限检查之前拦截（如阻止所有 `rm -rf`）
- 需要修改工具输入（如重写文件路径到沙箱）
- 需要审计所有工具调用（PostToolUse）

**何时使用 Permissions：**
- 需要用户授权（交互式决策）
- 需要持久化的安全策略
- 需要细粒度的 glob 匹配

**何时使用 allowed-tools：**
- 技能需要特定工具但不想频繁提示用户
- 临时授权，技能完成后自动撤销
- 减少用户交互，提升技能体验

### 实际案例：安全的部署技能

**SKILL.md：**

```markdown
---
name: deploy
allowed-tools: "Bash(npm run deploy*),Read(*)"
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bash ${CODARA_SKILL_ROOT}/scripts/validate-deploy.sh"
---

Deploy the application to production.

Steps:
1. Read deployment configuration
2. Run deployment script
```

**scripts/validate-deploy.sh：**

```bash
#!/bin/bash
COMMAND=$(echo "$TOOL_INPUT" | jq -r '.command')

# 检查是否是部署命令
if [[ "$COMMAND" == npm\ run\ deploy* ]]; then
  # 验证环境变量
  if [[ -z "$DEPLOY_ENV" ]]; then
    echo "Error: DEPLOY_ENV not set" >&2
    exit 2  # 拒绝
  fi

  # 验证分支
  BRANCH=$(git branch --show-current)
  if [[ "$BRANCH" != "main" ]]; then
    echo "Error: Must deploy from main branch" >&2
    exit 2  # 拒绝
  fi
fi

exit 0  # 放行到权限检查
```

**这个设计的安全层次：**

1. **Hook 层**：验证环境和分支（硬性要求，无法绕过）
2. **权限层**：技能临时允许 `npm run deploy*`（减少提示）
3. **用户配置**：用户可以添加 `deny: ["Bash(npm run deploy*)"]` 覆盖技能的临时权限

---
