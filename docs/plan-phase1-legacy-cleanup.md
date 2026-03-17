# Phase 1: 遗留清理 + 文档同步 ✅ COMPLETE

> 优先级：**HIGH** — 阻塞后续工作，技术债务清零

## 目标

消除 `src/core/` 迁移后的所有残留引用，确保文档与代码一致。

---

## 1.1 README 路径修复 ✅

### `src/engine/pipeline/README.md`
- [x] 无 `@core/middleware` 引用 — 全部使用 `@engine/pipeline`
- [x] 无 `@core/agents` 引用 — 全部使用 `@engine/agent`
- [x] 无断链 `src/core/middleware/HIL.md`

### `src/engine/agent/README.md`
- [x] 无 `src/core/agents/index.ts` 引用

### `src/capability/skill/README.md`
- [x] 无 `src/core/skills/` 引用

### `src/cli/README.md`
- [x] 无 `src/core` 引用 — 全部使用具体层路径

### `tasks/lessons.md`
- [x] 无 `src/core/` 引用

---

## 1.2 死代码清理 ✅

- [x] `lodash` 无直接 import（仅 package.json 依赖，可安全移除）
- [x] `console.warn()` in skill store/loading — 有意为之的诊断输出，非调试残留

---

## 验证 ✅

```
grep -r "src/core" src/ --include="*.md" → 0 matches
bunx tsc --noEmit → 0 errors
bun test tests/ → 900+ pass
```
