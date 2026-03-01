# 设计理念验证清单

## 需要从 Claude Code 官方文档验证的关键点

### 1. Skills 系统组织

**Codara 当前设计**：
- 所有扩展功能都是 skills
- Skills 可以包含：SKILL.md + agents/ + hooks/ + scripts/
- 内置代理类型（Explore/Plan/general-purpose）在 builtin-agents skill 中

**需要验证**：
- [ ] Claude Code 是否使用 "skills" 术语？
- [ ] Skills 目录结构是什么？
- [ ] 是否支持 agents/、hooks/ 子目录？
- [ ] 内置功能（commit、review-pr）如何组织？

### 2. 代理类型解析

**Codara 当前设计**：
```
解析顺序（2 层）：
1. .codara/skills/*/agents/{type}.md
2. ~/.codara/skills/*/agents/{type}.md
```

**需要验证**：
- [ ] Claude Code 是否有 standalone agents 路径（如 .claude/agents/）？
- [ ] 还是统一在 skills 中？
- [ ] 解析优先级是什么？

### 3. 内置代理类型

**Codara 当前设计**：
- Explore、Plan、general-purpose 在 builtin-agents skill 中
- 位置：~/.codara/skills/builtin-agents/agents/

**需要验证**：
- [ ] Claude Code 的内置代理类型有哪些？
- [ ] 它们如何组织？硬编码还是 skills？
- [ ] 用户如何覆盖内置代理？

### 4. 中间件与钩子

**Codara 当前设计**：
- 6-Hook 中间件架构
- Hooks 在 settings.json 或 skills/*/hooks/hooks.json

**需要验证**：
- [ ] Claude Code 是否使用中间件模式？
- [ ] 钩子系统如何工作？
- [ ] 钩子配置在哪里？

### 5. 扩展机制

**Codara 当前设计**：
- 统一通过 skills 扩展
- 项目级：.codara/skills/
- 用户级：~/.codara/skills/

**需要验证**：
- [ ] Claude Code 的扩展机制是什么？
- [ ] 是否有 plugins 概念？
- [ ] 项目级和用户级如何区分？

## 参考资源

### 官方文档
- Claude Code GitHub: https://github.com/anthropics/claude-code
- Anthropic Skills: https://github.com/anthropics/skills
- 官方文档: https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview

### 社区资源
- Everything Claude Code: https://github.com/affaan-m/everything-claude-code
- Claude Code Resource List: https://www.scriptbyai.com/claude-code-resource-list/

## 验证方法

1. **克隆官方仓库**
   ```bash
   git clone https://github.com/anthropics/claude-code.git /tmp/claude-code
   cd /tmp/claude-code
   ```

2. **查看文档结构**
   ```bash
   ls -la docs/
   cat docs/README.md
   ```

3. **查看实际代码**
   ```bash
   # 查找 skills 相关代码
   grep -r "skills" src/

   # 查找 agents 相关代码
   grep -r "agents" src/
   ```

4. **检查配置文件**
   ```bash
   # 查看默认配置
   cat .claude/config.json

   # 查看 skills 目录
   ls -la .claude/skills/
   ```

## 潜在的设计偏离风险

### 高风险
- ❌ 如果 Claude Code 有 standalone agents 路径，而 Codara 移除了
- ❌ 如果 Claude Code 不使用 "skills" 术语，而是 "plugins"
- ❌ 如果内置代理类型是硬编码的，而不是 skills

### 中风险
- ⚠️ Skills 目录结构不同（agents/、hooks/ 子目录）
- ⚠️ 解析优先级不同
- ⚠️ 中间件架构不同

### 低风险
- ✓ 命名差异（.codara vs .claude）
- ✓ 配置文件格式差异
- ✓ 文档组织方式差异

## 下一步行动

1. [ ] 获取 Claude Code 官方文档
2. [ ] 逐项验证上述清单
3. [ ] 记录发现的差异
4. [ ] 评估差异的影响
5. [ ] 决定是否需要调整 Codara 设计
6. [ ] 更新文档以反映验证结果
