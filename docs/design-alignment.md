# Codara vs Claude Code 设计理念对比

## 核心设计理念

### Codara 的核心理念

**"核心通用，领域扩展全靠 Skill"**

- 核心：Middleware + Tools + TUI（通用基础设施）
- 扩展：所有领域功能通过 Skills 实现
- 示例：commit、review-pr、Explore、Plan 都是 skills

### Claude Code 的实际设计

**需要验证的关键点**：

1. **Skills vs Plugins**
   - Claude Code 使用 "skills" 还是 "plugins"？
   - 内置功能（如 commit、review-pr）是如何组织的？

2. **内置代理类型**
   - Explore、Plan、general-purpose 在 Claude Code 中如何实现？
   - 是硬编码还是作为 skills/plugins？

3. **扩展机制**
   - 用户如何添加自定义功能？
   - 是否有统一的扩展单元？

4. **中间件架构**
   - Claude Code 是否使用中间件模式？
   - 钩子系统如何工作？

## 需要确认的设计差异

### 1. Skills 目录结构

**Codara 设计**：
```
.codara/skills/
├── builtin-agents/
│   └── agents/
│       ├── Explore.md
│       ├── Plan.md
│       └── general-purpose.md
├── commit/
│   └── SKILL.md
└── my-skill/
    ├── SKILL.md
    ├── agents/
    ├── hooks/
    └── scripts/
```

**Claude Code 实际**：
- 需要确认实际目录结构
- 是否支持 agents/、hooks/、scripts/ 子目录？

### 2. 代理解析路径

**Codara 设计**：
```
1. .codara/skills/*/agents/{type}.md
2. ~/.codara/skills/*/agents/{type}.md
```

**Claude Code 实际**：
- 是否有 standalone agents 路径（如 .codara/agents/）？
- 还是统一在 skills 中？

### 3. 内置功能组织

**Codara 设计**：
- 所有内置功能都是 skills
- builtin-agents 是一个 skill
- commit、review-pr 是 skills

**Claude Code 实际**：
- 内置功能是否也是 skills？
- 还是有特殊的内置路径？

## 潜在的设计偏离

### 可能的问题

1. **过度抽象**
   - Codara 是否过度强调"统一 skills"？
   - Claude Code 可能有更实用的混合方案？

2. **目录结构复杂度**
   - skills/*/agents/ 嵌套是否过深？
   - 是否应该有更扁平的结构？

3. **内置 vs 用户扩展**
   - 内置功能和用户扩展是否应该区分？
   - builtin-agents skill 是否是正确的方案？

## 需要参考的 Claude Code 文档

### 官方文档位置

1. **Skills 系统**
   - 文档路径：？
   - 关键内容：skill 定义、目录结构、扩展机制

2. **Agent 系统**
   - 文档路径：？
   - 关键内容：内置代理类型、自定义代理、解析路径

3. **Middleware/Hooks**
   - 文档路径：？
   - 关键内容：中间件架构、钩子系统

4. **扩展机制**
   - 文档路径：？
   - 关键内容：如何添加自定义功能

## 行动项

- [ ] 获取 Claude Code 官方文档
- [ ] 对比实际实现与 Codara 设计
- [ ] 识别设计偏离
- [ ] 修正不一致的地方
- [ ] 更新 Codara 文档以对齐 Claude Code
