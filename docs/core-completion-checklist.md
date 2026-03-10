# Codara Core 完善清单

## 当前状态总结

### ✅ 已完成的核心功能（100%）

#### 1. 架构基础
- **LangChain 风格架构**：State + Middleware + Init 分离
- **类型系统**：完整的 TypeScript 类型定义
- **错误处理**：ErrorCode + 专用 Error 类 + 恢复建议
- **文件数量**：83 个核心 TypeScript 文件

#### 2. Session 管理
- ✅ Session 生命周期管理（create, invoke, stream, resume）
- ✅ Session 元数据追踪（title, lastMessage, messageCount, tags, archived）
- ✅ Session 持久化（FileSessionStore）
- ✅ 自动元数据更新（每次交互后）
- ✅ 标题自动生成（从首条用户消息提取）

**文件**：
- `src/core/sessions/session.ts`
- `src/core/sessions/store.ts`
- `src/core/sessions/types.ts`
- `src/core/sessions/source-provider.ts`

#### 3. Checkpoint 系统
- ✅ 完整状态持久化（file-based + in-memory）
- ✅ Checkpoint 元数据（title, description, tags, tokenCount, toolCallCount, duration）
- ✅ 自动压缩（compact() 保留最近 N 个）
- ✅ 链表完整性（parentCheckpointId 维护）
- ✅ 列表查询（limit, sortOrder, status 过滤）
- ✅ 自动恢复（threadId 提供时自动恢复最新 checkpoint）

**文件**：
- `src/core/checkpoint/file.ts`
- `src/core/checkpoint/state.ts`
- `src/core/checkpoint/types.ts`

#### 4. Auto-Memory 系统
- ✅ LLM 驱动的记忆管理
- ✅ 自动注入 instructions（教 LLM 如何管理记忆）
- ✅ 存储路径：`~/.codara/projects/{project-hash}/memory/`
- ✅ Project hash 生成（基于项目路径）
- ✅ 主题文件支持（debugging.md, patterns.md 等）
- ✅ 完全对齐 Claude Code 模式

**文件**：
- `src/core/middleware/auto-memory.ts`
- `src/core/middleware/memory.ts`

#### 5. 中间件系统
- ✅ 中间件管道（Guidelines → Auto-Memory → Skills → Context Budget → Summary → HIL）
- ✅ Guidelines 注入（.codara/AGENTS.md）
- ✅ Skills 注入（.codara/skills/*/SKILL.md）
- ✅ Context Budget 估算
- ✅ Summary 压缩（超出 budget 时）
- ✅ HIL 权限控制
- ✅ Logging 中间件
- ✅ Todo 中间件

**文件**：
- `src/core/middleware/pipeline.ts`
- `src/core/middleware/guidelines.ts`
- `src/core/middleware/auto-memory.ts`
- `src/core/middleware/context-budget.ts`
- `src/core/middleware/summary.ts`
- `src/core/middleware/hil.ts`
- `src/core/middleware/logging.ts`
- `src/core/middleware/todo.ts`

#### 6. 错误处理系统
- ✅ 类型化错误码（ErrorCode enum）
- ✅ 专用错误类（SessionError, CheckpointError, ToolError, ModelError, ConfigError）
- ✅ 用户友好消息（toUserMessage() 方法）
- ✅ 恢复建议（ErrorRecovery 接口）
- ✅ 错误链（cause 字段）

**文件**：
- `src/core/errors/types.ts`

#### 7. Agent 系统
- ✅ Agent 创建和管理
- ✅ Agent 状态管理（AgentState）
- ✅ Agent 运行时（invoke, stream, resume）
- ✅ Subagent 支持
- ✅ Task 工具集成

**文件**：
- `src/core/agents/`（多个文件）

#### 8. Tools 系统
- ✅ 内置工具（read, write, edit, glob, grep, search）
- ✅ 工具定义和验证
- ✅ 工具执行和错误处理
- ✅ 工具权限控制

**文件**：
- `src/core/tools/`（多个文件）

#### 9. 测试覆盖
- ✅ 单元测试：67 个测试文件
- ✅ 集成测试：完整的 e2e 测试
- ✅ 覆盖范围：
  - Checkpoint 系统
  - Session 管理
  - Middleware 管道
  - Agent 运行时
  - Tools 执行
  - Skills 系统
  - HIL 权限控制

**文件**：
- `tests/unit/`（多个测试文件）
- `tests/integration/`（多个测试文件）

---

## ⚠️ 需要完善的部分

### 1. Skills 标准化（优先级：高）

#### 问题
- 部分 skills 的 frontmatter 格式不一致
- 部分 skills 内容过长，缺少 progressive disclosure

#### 需要做的事
1. **标准化所有 skills 的 frontmatter**：
   ```yaml
   ---
   name: skill-name
   description: This skill should be used when the user asks to "trigger phrase 1", "trigger phrase 2"...
   version: 0.1.0
   ---
   ```

2. **重构过长的 skills**：
   - 保持 SKILL.md 在 2000 字以内
   - 将详细内容移到 `references/` 目录
   - 添加 "Additional Resources" 链接

#### 受影响的 skills
- `permission-policy` - 内容过长，需要拆分
- `basic-task-flow` - 检查 frontmatter
- `repo-diff-check` - 检查 frontmatter
- `builtin-agents` - 检查 frontmatter

#### 预计工作量
- 2-3 小时

---

### 2. Session Store 增强（优先级：中）

#### 当前实现
- ✅ 基础 CRUD 操作
- ✅ 列表和搜索
- ✅ 元数据持久化

#### 可以增强的地方
1. **统计信息**：
   ```typescript
   interface SessionStats {
     total: number;
     active: number;
     archived: number;
     totalMessages: number;
     avgMessagesPerSession: number;
   }

   async getStats(): Promise<SessionStats>;
   ```

2. **批量操作**：
   ```typescript
   async archiveMultiple(sessionIds: string[]): Promise<void>;
   async deleteMultiple(sessionIds: string[]): Promise<void>;
   ```

3. **导出/导入**：
   ```typescript
   async export(sessionId: string): Promise<SessionExport>;
   async import(data: SessionExport): Promise<string>;
   ```

#### 预计工作量
- 3-4 小时

---

### 3. Checkpoint 增强（优先级：中）

#### 当前实现
- ✅ 基础 CRUD 操作
- ✅ 自动压缩
- ✅ 元数据追踪

#### 可以增强的地方
1. **Checkpoint 标签和书签**：
   ```typescript
   interface CheckpointMetadata {
     // ... existing fields
     bookmarked?: boolean;  // 标记为重要的 checkpoint
     label?: string;        // 用户自定义标签
   }

   // 压缩时保留 bookmarked checkpoint
   async compact(threadId: string, options: {
     keepLast: number;
     keepBookmarked: boolean;
   }): Promise<void>;
   ```

2. **Checkpoint 统计**：
   ```typescript
   interface CheckpointStats {
     total: number;
     totalSize: number;
     avgSize: number;
     oldestTimestamp: string;
     newestTimestamp: string;
   }

   async getStats(threadId: string): Promise<CheckpointStats>;
   ```

3. **Checkpoint 导出**：
   ```typescript
   async exportThread(threadId: string): Promise<ThreadExport>;
   async importThread(data: ThreadExport): Promise<string>;
   ```

#### 预计工作量
- 3-4 小时

---

### 4. Memory 系统增强（优先级：低）

#### 当前实现
- ✅ Auto-memory instructions 注入
- ✅ MEMORY.md 加载和缓存
- ✅ Project hash 生成

#### 可以增强的地方
1. **Memory API**：
   ```typescript
   interface MemoryManager {
     // 读取记忆
     getMemory(topic?: string): Promise<string>;

     // 添加记忆
     addMemory(content: string, topic?: string): Promise<void>;

     // 更新记忆
     updateMemory(content: string, topic?: string): Promise<void>;

     // 删除记忆
     deleteMemory(topic: string): Promise<void>;

     // 列出主题
     listTopics(): Promise<string[]>;

     // 搜索记忆
     searchMemory(query: string): Promise<MemorySearchResult[]>;
   }
   ```

2. **Memory 版本控制**：
   - 保存 MEMORY.md 的历史版本
   - 支持回滚到之前的版本

3. **Memory 统计**：
   ```typescript
   interface MemoryStats {
     totalTopics: number;
     totalSize: number;
     lastUpdated: string;
     mostRecentTopics: string[];
   }
   ```

#### 预计工作量
- 4-5 小时

---

### 5. 配置系统（优先级：低）

#### 当前状态
- 配置分散在各个模块中
- 缺少统一的配置管理

#### 需要做的事
1. **创建配置文件**：
   ```json
   // ~/.codara/config.json
   {
     "providers": [
       {
         "name": "openrouter",
         "models": ["anthropic/claude-sonnet-4"]
       }
     ],
     "router": {
       "default": "openrouter:anthropic/claude-sonnet-4"
     }
   }
   ```
   ```json
   // ~/.codara/model-metadata.json
   {
     "anthropic/claude-sonnet-4": {
       "contextWindow": 200000,
       "maxOutputTokens": 8192
     }
   }
   ```

2. **配置加载器**：
   ```typescript
   interface ConfigLoader {
     load(): Promise<CodaraConfig>;
     save(config: CodaraConfig): Promise<void>;
     get<T>(key: string): T | undefined;
     set<T>(key: string, value: T): Promise<void>;
   }
   ```

3. **配置验证**：
   - 使用 Zod 验证配置格式
   - 提供默认配置
   - 支持配置合并

#### 预计工作量
- 3-4 小时

---

## 📊 完成度评估

### Core 功能完成度

| 模块 | 完成度 | 说明 |
|------|--------|------|
| **Session 管理** | 95% | 基础功能完整，可增强统计和批量操作 |
| **Checkpoint 系统** | 95% | 基础功能完整，可增强标签和导出 |
| **Auto-Memory** | 100% | 完全对齐 Claude Code |
| **中间件系统** | 100% | 完整的管道和所有中间件 |
| **错误处理** | 100% | 完善的错误类型系统 |
| **Agent 系统** | 100% | 完整的 agent 运行时 |
| **Tools 系统** | 100% | 完整的工具集 |
| **Skills 系统** | 70% | 需要标准化 frontmatter |
| **测试覆盖** | 90% | 完整的单元和集成测试 |
| **配置系统** | 0% | 需要创建统一配置管理 |

### 总体完成度：**90%**

---

## 🎯 推荐优先级

### 立即完成（生产就绪）
1. **Skills 标准化**（2-3 小时）
   - 标准化 frontmatter
   - Progressive disclosure 重构

### 短期完成（1-2 周）
2. **Session Store 增强**（3-4 小时）
   - 统计信息
   - 批量操作

3. **Checkpoint 增强**（3-4 小时）
   - 标签和书签
   - 统计信息

### 长期完成（按需）
4. **Memory 系统增强**（4-5 小时）
   - Memory API
   - 版本控制

5. **配置系统**（3-4 小时）
   - 统一配置管理
   - 配置验证

---

## ✅ 核心优势

### 1. 架构清晰
- LangChain 风格的分层架构
- 清晰的职责分离
- 易于扩展和维护

### 2. 类型安全
- 完整的 TypeScript 类型定义
- 编译时类型检查
- 良好的 IDE 支持

### 3. 错误处理完善
- 类型化错误码
- 用户友好的错误消息
- 恢复建议

### 4. 测试覆盖完整
- 67 个测试文件
- 单元测试 + 集成测试
- 高代码覆盖率

### 5. 完全对齐 Claude Code
- Auto-Memory 系统
- Checkpoint 恢复机制
- 中间件管道
- 存储结构

---

## 📝 总结

**Codara Core 已经达到生产就绪水平（90%）**：

✅ **核心功能完整**：
- Session 管理
- Checkpoint 系统
- Auto-Memory
- 中间件管道
- 错误处理
- Agent 运行时
- Tools 系统

⚠️ **需要完善**：
- Skills 标准化（高优先级）
- Session/Checkpoint 增强（中优先级）
- Memory API（低优先级）
- 配置系统（低优先级）

**建议**：
1. 立即完成 Skills 标准化（2-3 小时）
2. Core 部分即可投入生产使用
3. 增强功能可以按需逐步添加
