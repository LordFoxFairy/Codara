# Phase 2: 架构深度打磨 ✅ COMPLETE

> 优先级：**HIGH** — 提升代码质量和可维护性

## 目标

统一命名规范、消除重复、加强类型安全。

---

## 2.1 Middleware 工厂一致性 ✅

- [x] `ToolHooksMiddleware` class → `createToolHooksMiddleware()` factory
- [x] `todoListMiddleware()` → `createTodoListMiddleware()`
- [x] `createAskUserTool()` 内聚到 `AskUserQuestionMiddleware`
- [x] `MIDDLEWARE_NAMES` 常量集中管理
- [x] 移除 `humanInTheLoopMiddleware` 遗留别名

## 2.2 Guidelines 渐进披露 ✅

- [x] `progressive-source.ts` 两阶段加载
- [x] `GuidelinesMiddleware` — wrapToolCall 按需注入子目录 AGENTS.md
- [x] 注入到 ToolMessage（不污染 system prompt，compact 安全）

## 2.3 Token Budget 精度 ✅

- [x] `budget.ts` CJK 感知估算（`asciiLength/4 + cjkCount*1.5`）
- [x] CJK 正则 `[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F]`
- [x] 集成到 `estimateModelInputTokens()` → `BudgetMiddleware`

## 2.4 Auto-Memory 激活 ✅

- [x] `facade.ts` 正确传递 `autoMemory` 配置
- [x] `autoMemory === false` 才禁用（修复 falsy 判断）
- [x] `/memory` 命令路径正确

## 2.5 Session 事件补全 ✅

- [x] `runtime-events.ts` — 8 种事件类型（turn/model/tool/task/hil/command/summary/hook）
- [x] Compact 事件通过 `summary` kind 触发
- [x] 子代理 stats（toolUseCount + totalTokens）端到端

---

## 验证 ✅

```
bunx tsc --noEmit → 0 errors
bun test tests/ → 900+ pass
```
