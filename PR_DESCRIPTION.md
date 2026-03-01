# Codara 完整架构文档与设计改进

## 概述

本 PR 完成了 Codara 的完整架构文档编写，涵盖 10 个核心子系统，并进行了关键的架构设计改进。

## 文档结构

### 新增文档（5,361 行）

1. **00-architecture-overview.md** (423 行) — 全局架构视图
2. **01-agent-loop.md** (268 行) — 核心执行循环
3. **02-model-routing.md** (340 行) — 模型路由与提供商
4. **03-tools.md** (198 行) — 工具系统
5. **04-permissions.md** (510 行) — 权限与安全
6. **05-hooks.md** (413 行) — 中间件与钩子
7. **06-skills.md** (341 行) — 技能扩展系统
8. **07-agent-collaboration.md** (428 行) — 代理协作
9. **08-memory-system.md** (558 行) — 记忆与上下文
10. **09-terminal-ui.md** (1,493 行) — 终端界面设计
11. **design-review.md** (322 行) — 架构审查与改进建议
12. **problems.md** (29 行) — 已解决的设计问题
13. **README.md** (37 行) — 文档索引

## 核心改进

### 1. 技能系统架构升级

**变更**：Skill 成为统一扩展单元，支持 agents/、hooks/、scripts/、references/、assets/ 子目录。

**影响**：
- ✅ 技能可以打包自己的代理定义
- ✅ 技能可以打包自己的钩子配置
- ✅ 技能可以打包可执行脚本
- ✅ 资源解析优先级：项目 standalone → 项目 skill → 用户 standalone → 用户 skill → 内置

**示例**：
```
.codara/skills/code-review/
├── SKILL.md
├── agents/
│   ├── reviewer.md
│   ├── security-checker.md
│   └── style-checker.md
├── hooks/
│   └── hooks.json
└── scripts/
    └── run-linter.sh
```

### 2. 内置代理类型重构为 Skills

**变更**：Explore、Plan、general-purpose 从硬编码改为内置 skills。

**原因**：
- ❌ 硬编码违反"核心通用，领域扩展全靠 Skill"原则
- ❌ 扩展性差，新增代理类型需要修改核心代码
- ❌ 用户无法完全覆盖内置行为

**新架构**：
```
~/.codara/skills/
├── explore/agents/Explore.md
├── plan/agents/Plan.md
└── general-purpose/agents/general-purpose.md
```

**优势**：
- ✅ 架构一致性：所有扩展功能都是 skill
- ✅ 零核心修改扩展：新增代理类型只需 .md 文件
- ✅ 用户完全可控：项目/用户 skill 自然覆盖内置 skill

### 3. 权限系统集成说明

**新增**：04-permissions.md 完整的集成章节

**内容**：
- 工具调用检查流程图
- Hooks vs PermissionMiddleware 关系
- Skills allowed-tools 作为临时允许规则
- 三层安全示例（deploy skill）
- 优先级表：PreToolUse Hooks (最高) → PermissionMiddleware → Skills allowed-tools (最低)

### 4. 人在回路交互机制

**新增**：09-terminal-ui.md Section 11

**内容**：
- PermissionDialog：工具权限审批（4 固定选项）
- QuestionDialog：AI 驱动决策询问（2-4 可配置选项，支持单选/多选/预览）
- ConfirmDialog：明确 Yes/No 决策（2 选项 + 反馈输入）
- 事件回调模式、与权限系统集成、设计原则

### 5. TodoWrite vs Task TUI 渲染

**新增**：09-terminal-ui.md Section 3.10

**内容**：
- TodoWrite：自动插入系统消息，显示进度框，原地更新
- Task*：作为工具输出显示，不自动刷新，每次 TaskList 生成新输出
- 对比表：TUI 渲染、触发方式、视觉位置、更新方式、持久性、典型用户

### 6. Rules 在 Memory 系统中的定位

**新增**：08-memory-system.md "规则文件的定位"小节

**内容**：
- CODARA.md（项目宪法）vs rules/*.md（法律条文）
- 对比表：性质、内容、组织、复用、frontmatter、典型用途
- 设计理念：模块化管理、选择性加载、跨项目复用、团队协作

## 架构设计质量

### 改进前：8.5/10
- ✅ 架构清晰，文档完整
- ✅ 核心原则一致
- ❌ 内置代理类型硬编码

### 改进后：9.5/10
- ✅ 完全一致的扩展模型
- ✅ 零核心修改即可扩展
- ✅ 用户完全可控
- ✅ 文档即代码

## 提交历史

```
e8861d0 docs: 架构审查与内置代理类型重构为 Skills
6643f88 docs: 明确 rules 在 memory 系统中的定位
5338bea docs: 明确 TodoWrite vs Task 的 TUI 渲染机制
4fab26d docs: 添加人在回路交互机制文档
7ba6b2a feat(docs): 完善权限系统与 middleware/hooks/skills 的集成说明
fb33c9c feat(init): docs
fa722db feat(docs): 技能系统架构升级 - Skill 作为统一扩展单元
e3de405 feat(init): docs
```

## 测试

- [x] 所有文档交叉引用一致
- [x] 资源解析优先级在所有文档中表述一致
- [x] Markdown 格式正确
- [x] 代码示例语法正确

## 后续工作

### P0（必须）：
1. 实现内置 skills（explore/plan/general-purpose）
2. 移除代理解析中的硬编码回退
3. 安装时部署内置 skills

### P1（建议）：
1. 明确 skill 的 `agent` 字段语义
2. 补充 `context: fork` 的详细说明
3. 添加"如何创建自定义代理类型"教程

### P2（可选）：
1. 提供 skill 模板生成器（`codara skill init <name>`）
2. 支持 skill 的版本管理和依赖
3. 建立 skill 市场/仓库

## 影响范围

- **文档**：新增 13 个文档文件
- **核心代码**：无（纯文档 PR）
- **破坏性变更**：无
- **向后兼容**：完全兼容

## 审查要点

1. 架构设计是否合理？
2. 内置代理类型改为 skills 是否可行？
3. 文档是否清晰易懂？
4. 是否有遗漏的设计细节？
