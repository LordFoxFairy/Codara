# Phase 3: MCP (Model Context Protocol) 集成 ✅ COMPLETE

> 优先级：**HIGH** — 核心新特性，对标 Claude Code

## 目标

实现 MCP 客户端集成，支持 stdio/HTTP 传输，工具自动发现，与权限系统无缝对接。

---

## 架构设计

```
                 ┌─────────────────┐
                 │   codara.json   │  ← 配置文件
                 │   ~/.codara/    │
                 └────────┬────────┘
                          │
                 ┌────────▼────────┐
                 │  McpManager     │  ← 生命周期管理
                 │  (懒初始化)      │
                 └────────┬────────┘
                          │
           ┌──────────────┼──────────────┐
           │              │              │
    ┌──────▼──────┐ ┌────▼──────┐ ┌────▼──────┐
    │ StdioClient │ │ HttpClient│ │ SseClient │  ← 传输层
    └──────┬──────┘ └────┬──────┘ └────┬──────┘
           │              │              │
    ┌──────▼──────────────▼──────────────▼──────┐
    │           MCP Tool Registry               │
    │  (discover → wrap → inject into pipeline) │
    └──────────────────┬────────────────────────┘
                       │
              ┌────────▼────────┐
              │ PermissionMiddleware │  ← 权限检查
              │ (deny→ask→allow)    │
              └─────────────────────┘
```

---

## 3.1 目录结构 ✅

```
src/engine/mcp/
├── index.ts              # 公共导出
├── types.ts              # McpServerConfig, McpClientStatus, McpTool
├── manager.ts            # McpManager — 客户端生命周期
├── client.ts             # McpClient — 单个服务器连接
├── transport/
│   ├── stdio.ts          # StdioClientTransport
│   └── http.ts           # StreamableHTTP + SSE 回退
├── tool-adapter.ts       # MCP tool → LangChain StructuredTool
└── config.ts             # 配置加载（项目 + 全局合并）
```

---

## 3.2 实现步骤 ✅

### Step 1: 类型定义 (`types.ts`) ✅
- [x] `McpServerConfig` — local (command[]) / remote (url)
- [x] `McpClientStatus` — connected | disabled | failed | reconnecting
- [x] `McpToolDefinition` — name, description, inputSchema
- [x] `McpClientInfo` — name, status, tools[], lastError?

### Step 2: 配置加载 (`config.ts`) ✅
- [x] 加载 `.codara/mcp.json`（项目级）
- [x] 加载 `~/.codara/mcp.json`（全局级）
- [x] 合并策略：项目级同名覆盖全局级
- [x] 环境变量展开 `${VAR_NAME}`
- [x] Zod schema 校验

### Step 3: 传输层 (`transport/`) ✅
- [x] `createStdioTransport(config)` — 子进程 spawn + stdio 管道
- [x] `createHttpTransport(config)` — StreamableHTTP + SSE 回退

### Step 4: 客户端 (`client.ts`) ✅
- [x] `McpClient` — connect / listTools / callTool / close

### Step 5: 管理器 (`manager.ts`) ✅
- [x] `McpManager` — init / getTools / callTool / dispose / status
- [x] 失败隔离：一个服务器连接失败不影响其他

### Step 6: 工具适配 (`tool-adapter.ts`) ✅
- [x] MCP tool → LangChain `StructuredToolInterface` 转换

### Step 7: Pipeline 集成 ✅
- [x] MCP tools 合并到 `runtimeTools`（通过 facade.ts）
- [x] 权限集成：MCP 工具默认 `ask` 模式

### Step 8: CLI 集成 ✅
- [x] `/mcp` 命令 — 显示连接状态和工具数
- [x] StatusBar 显示 MCP 连接状态（`MCP:3` 或 `MCP:2/3`）

---

## 3.3 依赖 ✅

```json
"@modelcontextprotocol/sdk": "^1.27.1"
```

---

## 验证 ✅

```
bunx tsc --noEmit → 0 errors
bun test tests/ → 900+ pass
```
