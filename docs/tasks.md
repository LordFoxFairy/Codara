# Codara 功能完成记录

## CLI UI

- [x] 欢迎页面（WelcomeState）
- [x] 欢迎页 → 对话页自然过渡（移除清屏，统一单流布局）
- [x] 轻量状态栏（StatusBar 替代重型 Header）
- [x] 对话消息风格对齐 Claude Code（`>` 用户前缀、助手无前缀）
- [x] 工具调用结构化显示（icon + tree connector）
- [x] Braille spinner + Edit/Write diff 预览
- [x] PromptFrame 输入框
- [x] Footer 快捷键提示
- [x] ActivityLine 运行状态指示
- [x] StatusBar token 用量（↓prompt ↑completion）
- [x] Ctrl+O 展开/折叠工具输出
- [x] Task Panel（子代理 stats：tool uses + tokens + 耗时）
- [x] Command Completion（Tab 补全 / 命令菜单）
- [x] Session Picker（/resume 过滤空 session）
- [x] CommandOutputPanel（wrap="truncate-end"）

## 权限系统

- [x] Permission middleware（deny → ask → allow 策略）
- [x] HIL 审核面板（HilPanel）
- [x] 权限 review flow

## 核心能力

- [x] Subagents（general-purpose 默认类型 + 自定义 subagent 定义）
- [x] Plan Mode（过滤 write_file/edit_file）
- [x] Session 管理 — `--resume <session-id>` CLI 参数恢复会话
- [x] 命令系统（18 个 builtin commands）
- [x] Transcript 持久化（FileCheckpointer → .codara/checkpoints/）
- [x] Auto-Memory 运行时激活
- [x] Context Budget（CJK 感知 token 估算 + 95% 自动 compact）
- [x] MCP 集成（stdio/HTTP 传输 + 工具发现 + 权限对接）
- [x] 条件规则（.codara/rules/*.md glob 匹配）
- [x] Headless/CI 模式（-p, --json, -c, --fork-session）
- [x] Worktree 隔离（git worktree create/remove）
- [x] Well-known 模型上下文窗口（OpenRouter 前缀支持）

## 测试覆盖

- [x] 单元测试 900+ pass
- [x] 集成测试 16 场景
- [x] Case 测试 37 场景（命令、权限、内存、插件、技能）
