# 已解决的设计问题

以下问题在 Middleware 6-Hook 架构重构中已全部解决。

## ✅ Middleware 贯穿全程
- 6 个钩子（beforeAgent, beforeModel, afterModel, afterAgent, wrapModelCall, wrapToolCall）
- 每个 Agent 实例拥有独立的 MiddlewarePipeline
- 核心循环零业务逻辑，只做 pipeline 钩子调度

## ✅ 安全阀 / 上下文压缩移入 Middleware
- SafetyMiddleware (required: true, priority: 5) → beforeAgent
- CompressionMiddleware (priority: 25) → beforeModel
- RetryMiddleware (priority: 30) → wrapModelCall

## ✅ TodoWrite / Task* 改为普通工具
- 扁平注册到 ToolRegistry，不再需要独立的 TodoMiddleware / TaskMiddleware
- SubagentMiddleware 负责从代理的工具过滤

## ✅ 从代理类型配置化
- subagent_type 是查找键：先查 .codara/agents/，再查内置默认
- 内置类型（Explore, Plan, general-purpose）只是默认配置，可被覆盖

## ✅ Tab 选项对话框
- AskUserQuestion 是普通工具，执行时 yield ask_user 事件
- TUI 根据事件类型渲染不同对话框（permission_request / ask_user / confirm）
- 事件回调是中间件的内部实现细节，不是替代方案

## ✅ 从代理生命周期 = SubagentMiddleware.wrapToolCall
- 不需要独立的 hook，通过中间件的 wrapToolCall 统一处理
