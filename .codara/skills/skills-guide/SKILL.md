---
name: skills-guide
description: 查看技能系统完整文档和快速入门
argument-hint: "[topic]"
user-invocable: true
disable-model-invocation: true
---

# 技能系统快速入门

> **⭐ Skills 是扩展 Codara 的唯一入口**
>
> 无论是内部功能还是外部扩展，都通过 Skills 实现。

---

## 快速查询

调用方式：
- `/skills-guide` - 查看完整文档
- `/hooks-guide` - 查看钩子文档
- `/permissions-guide` - 查看权限文档

---

## 什么是 Skills？

Skills 是 Codara 的**统一扩展单元**，每个技能是一个自包含的目录：

```
.codara/skills/my-skill/
├── SKILL.md              # 必需：技能定义
├── scripts/              # 可选：可执行脚本
├── hooks/                # 可选：钩子配置
├── agents/               # 可选：自定义代理
└── references/           # 可选：参考文档
```

---

## 为什么使用 Skills？

| 直接配置 settings.json | 通过 Skills 封装 |
|----------------------|-----------------|
| 配置分散，难以管理 | 所有资源集中在一个目录 |
| 难以复用和分享 | 可以打包分发整个 skill 目录 |
| 缺乏上下文和文档 | SKILL.md 提供完整说明 |
| 全局生效，影响所有会话 | 按需调用，作用域清晰 |
| 需要手动编写 JSON | 可以使用模板变量和动态注入 |

---

## 快速创建一个 Skill

### 1. 创建目录

```bash
mkdir -p .codara/skills/my-skill
cd .codara/skills/my-skill
```

### 2. 创建 SKILL.md

```markdown
---
name: my-skill
description: 我的第一个技能
user-invocable: true
---

这是我的第一个技能！

当前分支：!`git branch --show-current`
```

### 3. 使用技能

```bash
# 在 Codara 中调用
/my-skill
```

---

## 常见 Skills 模式

### 1. 安全检查 Skill

阻止危险命令：

```markdown
---
name: security-check
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bash ${CODARA_SKILL_ROOT}/scripts/check.sh"
---
```

### 2. 审计日志 Skill

记录所有工具调用：

```markdown
---
name: audit-logger
hooks:
  PostToolUse:
    - matcher: "*"
      hooks:
        - type: command
          command: "echo \"$TOOL_NAME\" >> /tmp/audit.log"
---
```

### 3. 代码审查 Skill

只读访问 + 自动检查：

```markdown
---
name: code-review
allowed-tools: "Read(*),Grep(*),Glob(*)"
---

Review the code and identify issues.
```

---

## Skills 能做什么？

### 1. 临时授权（allowed-tools）

```markdown
---
allowed-tools: "Bash(git *),Read(*)"
---
```

技能执行期间，这些工具无需用户确认。

### 2. 钩子（hooks）

```markdown
---
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "echo 'Before bash'"
---
```

在工具执行前后运行自定义逻辑。

### 3. 动态内容注入

```markdown
当前状态：!`git status --short`
最近提交：!`git log --oneline -5`
```

执行时自动替换为命令输出。

### 4. 文件链接

```markdown
遵循以下规范：
[编码标准](./references/standards.md)
```

自动内联文件内容。

---

## 内置 Skills

Codara 内置了一些常用 skills：

| Skill | 用途 |
|-------|------|
| `/commit` | 自动生成 commit 消息并提交 |
| `/init` | 生成 CODETERM.md 配置文件 |
| `/review-pr` | 审查 Pull Request 或分支更改 |

---

## 扩展 Codara

### 内部扩展（项目级）

```bash
.codara/skills/deploy/
.codara/skills/test/
.codara/skills/build/
```

### 外部扩展（用户级）

```bash
~/.codara/skills/my-workflow/
~/.codara/skills/custom-check/
```

### 社区扩展（第三方）

```bash
# 通过 npm 安装
npm install -g codara-skill-security-scanner

# 通过 Git 子模块
git submodule add https://github.com/org/skill .codara/skills/skill-name
```

---

## 完整文档

详细的技能系统文档，请参阅：
`docs/06-skills.md`

包含：
- 设计理念
- SKILL.md 格式
- 模板展开
- 技能权限
- 技能钩子
- 工具调用流程
- 5 个实战示例
- Skills 生态与分发

或在线查看：
https://github.com/your-org/codara/blob/main/docs/06-skills.md

---

## 相关文档

- `/hooks-guide` - 查看钩子文档
- `/permissions-guide` - 查看权限文档

---

**开始创建你的第一个 Skill 吧！**
