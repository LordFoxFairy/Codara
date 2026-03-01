# Claude Code 官方设计 - 关键发现

## 来源

- 官方文档: https://code.claude.com/docs
- Skills 实现: https://newsletter.victordibia.com/p/implementing-claude-code-skills-from
- 开放标准: https://agentskills.io

## 核心发现

### 1. Skills 系统 ✅

**Claude Code 确实使用 "Skills" 术语**

Skills 是包含指令和脚本的文件夹，代理可以按需发现和加载。

**目录结构**：
```
.claude/skills/
├── commit/
│   └── SKILL.md
├── code-review/
│   ├── SKILL.md
│   ├── examples/
│   └── scripts/
```

**SKILL.md 格式**：
```yaml
---
name: commit
description: Create a git commit
allowed-tools: Bash(git add:*), Bash(git status:*)
---

## Context
- Current git status: !`git status`

## Your task
Based on the above changes, create a single git commit.
```

**关键特性**：
- YAML frontmatter: name, description, allowed-tools
- Markdown body: 任务指令
- 可选子目录: scripts/, references/, assets/

### 2. 三层加载策略

1. **元数据 (~100 tokens)**: 启动时加载名称和描述
2. **指令 (< 5,000 tokens)**: 激活时加载完整 SKILL.md
3. **资源**: 仅在需要时加载额外文件

### 3. Skills 是开放标准

- 标准化在 agentskills.io
- 25+ 工具采用
- 一次定义，跨工具使用

### 4. 自定义功能

**CLAUDE.md**：
- 项目根目录的 markdown 文件
- 每次会话开始时读取
- 用于编码标准、架构决策、首选库

**Auto Memory**：
- Claude 自动保存学习内容
- 如构建命令、调试见解
- 跨会话持久化

**Hooks**：
- 在 Claude Code 操作前后运行 shell 命令
- 如编辑后自动格式化、提交前运行 lint

### 5. Sub-Agents

- 多个 Claude Code 代理同时工作
- Lead agent 协调工作、分配子任务、合并结果

### 6. 扩展机制

**MCP (Model Context Protocol)**：
- 连接 AI 工具到外部数据源的开放标准
- 可读取 Google Drive、更新 Jira、从 Slack 拉取数据

## 与 Codara 设计对比

### ✅ 一致的地方

1. **Skills 作为扩展单元** - 完全一致
2. **SKILL.md 格式** - YAML frontmatter + Markdown body
3. **allowed-tools** - 临时权限规则
4. **子目录支持** - scripts/, references/, assets/
5. **CLAUDE.md** - 项目指令文件
6. **Hooks** - 生命周期钩子
7. **Sub-agents** - 从代理系统

### ❓ 需要进一步验证

1. **agents/ 子目录** - 文章未提及 skills 是否可以包含 agents/
2. **内置代理类型** - Explore/Plan/general-purpose 如何组织？
3. **代理解析路径** - 是否有 standalone agents 路径？
4. **builtin-agents skill** - 内置代理是否在一个 skill 中？

### 📝 关键差异（待确认）

**Codara 设计**：
```
.codara/skills/
├── builtin-agents/
│   └── agents/
│       ├── Explore.md
│       ├── Plan.md
│       └── general-purpose.md
```

**需要确认**：
- Claude Code 是否支持 skills/*/agents/ 子目录？
- 还是内置代理类型是硬编码的？

## 下一步验证

1. [ ] 查找 Claude Code 关于 agents 的官方文档
2. [ ] 确认是否支持 skills/*/agents/ 子目录
3. [ ] 确认内置代理类型（Explore/Plan）的组织方式
4. [ ] 确认代理解析路径和优先级

## 参考资源

- [Claude Code 官方文档](https://code.claude.com/docs)
- [Skills 实现详解](https://newsletter.victordibia.com/p/implementing-claude-code-skills-from)
- [Agent Skills 开放标准](https://agentskills.io)
- [Complete Guide to Subagents, Skills, Hooks](https://www.theneuron.ai/explainer-articles/claude-code-automations-complete-guide/)
- [Claude Code Custom Agents Guide](https://blockchain.news/ainews/claude-code-custom-agents-step-by-step-guide-to-build-sub-agents-with-tools-and-default-agent-settings)
