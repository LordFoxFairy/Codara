/**
 * Codara - AI 驱动的代码助手
 * @module codara
 */

// ============================================
// 核心 API（CLI 和基础使用）
// ============================================

/** 创建或打开 Codara 会话（推荐入口） */
export {createCodara, openCodaraSession, openLatestCodaraSession} from '@core/codara';

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
export type {TaskRecord, TaskStore, TaskStatus, CreateTaskInput, UpdateTaskInput} from '@core/tasking';

/** Session 相关类型 */
export type {Session, SessionState, SessionStatus, SessionStore} from '@core/sessions';

// ============================================
// 高级 API（Library 使用）
// ============================================

/** Agent 构建 */
export {createAgent} from '@core/agents';

/** Session 管理 */
export {createSession, FileSessionStore} from '@core/sessions';

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
  createConversationContextMiddleware,
  createGuidelinesMiddleware,
  createSkillsMiddleware,
  createHILMiddleware,
  createLoggingMiddleware,
} from '@core/middleware';
export {
  createSharedTaskMiddleware,
  createTaskMiddleware,
} from '@core/tasking';
export {
  createCodaraGuidelinesSource,
  createCodaraSkillsSource,
  createSourceTurnContextPreparer,
} from '@core/sources';

// ============================================
// 类型导出（供高级用户使用）
// ============================================

export type {
  BaseMiddleware,
  ConversationContextMiddlewareOptions,
  HILMiddlewareOptions,
  LoggingMiddlewareOptions,
  HILResumePayload,
} from '@core/middleware';
export type {
  AgentsFileOverview,
  AgentsFileScope,
  GuidelinesOptions,
  GuidelinesSource,
  SkillsSource,
  SourceTurnContextOptions,
} from '@core/sources';

export type {AgentCheckpoint, AgentCheckpointer} from '@core/checkpoint';
