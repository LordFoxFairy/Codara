/**
 * Codara - AI 驱动的代码助手
 * @module codara
 */

// ============================================
// 核心 API（CLI 和基础使用）
// ============================================

/** 创建 Codara 实例（推荐入口） */
export {createCodara} from '@core/codara';

/** Codara 相关类型 */
export type {
  Codara,
  CodaraOptions,
} from '@core/codara';

/** Agent 相关类型 */
export type {
  Agent,
  AgentResult,
  AgentInput,
  AgentStreamOutput,
  AgentInvokeConfig,
  AgentStreamConfig,
  AgentResumeConfig,
  AgentResumeStreamConfig,
} from '@core/agents';
export type {TaskRecord, TaskStore, TaskStatus, CreateTaskInput, UpdateTaskInput} from '@core/tasks';

/** Session 相关类型 */
export type {Session, SessionState, SessionStatus} from '@core/sessions';

// ============================================
// 高级 API（Library 使用）
// ============================================

/** Agent 构建 */
export {createAgent, createSubagentTool, createTaskTool} from '@core/agents';
export {createCodaraTaskTool} from '@core/codara';
export {
  createTaskMemoryStore,
  createTaskFileStore,
  createTaskTools,
  createTaskCreateTool,
  createTaskUpdateTool,
  createTaskListTool,
} from '@core/tasks';

/** Session 管理 */
export {createSession} from '@core/sessions';

/** Checkpoint 管理 */
export {
  createAgentMemoryCheckpointer,
  createAgentFileCheckpointer,
  InMemoryCheckpointer,
  FileCheckpointer,
} from '@core/checkpoint';

/** Middleware */
export {
  createMiddleware,
  createMemoryMiddleware,
  createGuidelinesMiddleware,
  createSummaryMiddleware,
  createSkillsMiddleware,
  createHILMiddleware,
  createLoggingMiddleware,
} from '@core/middleware';

/** Tools */
export {createCodaraTools} from '@core/codara';

/** Model */
export {createCodaraModelCatalog, createCodaraChatModel} from '@core/codara';

// ============================================
// 类型导出（供高级用户使用）
// ============================================

export type {
  BaseMiddleware,
  SummaryOptions,
  HILMiddlewareOptions,
  LoggingMiddlewareOptions,
  HILResumePayload,
} from '@core/middleware';

export type {AgentCheckpoint, AgentCheckpointer} from '@core/checkpoint';

export type {CodaraModelCatalog} from '@core/codara';
export type {SourceProvider} from '@core/sessions';
