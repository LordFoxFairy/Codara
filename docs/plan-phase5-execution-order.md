# 执行总览 — 各 Phase 依赖与优先级 ✅ ALL COMPLETE

## 执行顺序

```
Phase 1: 遗留清理        ✅ COMPLETE
    │
Phase 2: 架构打磨        ✅ COMPLETE
    │
    ├── Phase 4: 深度测试  ✅ COMPLETE
    │
    └── Phase 3: MCP 集成  ✅ COMPLETE
         │
         └── Phase 4 补充   ✅ COMPLETE
```

## 每个 Phase 的产出

| Phase | 产出 | 状态 |
|-------|------|------|
| 1 | README 修复 + 死代码清理 | ✅ 无 src/core 残留引用 |
| 2 | CJK token 估算 + auto-memory 激活 + 事件补全 | ✅ 全部实现 |
| 3 | MCP 完整集成（stdio/HTTP + 工具发现 + 权限） | ✅ 全部实现 |
| 4 | 960+ tests（单元 + 集成 + case） | ✅ 全量通过 |

## 已解决的风险点

1. ~~MCP SDK 兼容性~~ → `@modelcontextprotocol/sdk@^1.27.1` Bun 兼容 ✅
2. ~~Stdio transport 在 Bun 中的行为~~ → 正常工作 ✅
3. ~~Token budget 精度~~ → CJK 感知加权估算 ✅
4. ~~Auto-memory 影响测试~~ → `autoMemory: false` 可禁用 ✅
