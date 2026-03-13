/**
 * Codara - AI 驱动的代码助手
 * @module codara
 */

// ============================================
// 核心 API（CLI 和基础使用）
// ============================================

/** 创建或打开 Codara 会话（推荐入口） */
export {createCodara, createCodaraRuntime, DEFAULT_CODARA_MODEL_ALIAS, openCodaraSession, openLatestCodaraSession} from '@core/codara';

/** Codara 相关类型 */
export type {
  Codara,
  CodaraRuntimeOptions,
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
  createBudgetMiddleware,
  createSummaryMiddleware,
  createSkillsMiddleware,
  createHILMiddleware,
  createInteractionMiddleware,
  createAskUserTool,
  ASK_USER_TOOL_NAME,
  parseAskUserResult,
  createLoggingMiddleware,
  createPermissionMiddleware,
  createPermissionRuntime,
  ensurePermissionSettingsFile,
  evaluatePermissionExpression,
  evaluatePermissionToolCall,
  formatPermissionExpression,
  handlePermissionFallbackResume,
  isPermissionPause,
  persistAllowedPermission,
  persistPermissionScope,
  persistPermissionRule,
  validatePermissionSettings,
} from '@core/middleware';
export {
  createSharedTaskMiddleware,
  createTaskMiddleware,
} from '@core/tasks';
export {
  createCodaraGuidelinesSource,
} from '@core/instructions/guidelines';
export {
  createCodaraPromptSource,
} from '@core/instructions/prompt';
export {
  readBaseSystemMessage,
} from '@core/instructions/system-message';
export {
  createCodaraSkillsSource,
} from '@core/skills';

// ============================================
// 类型导出（供高级用户使用）
// ============================================

export type {
  AskUserInput,
  AskUserOption,
  AskUserQuestion,
  AskUserResult,
  BaseMiddleware,
  BudgetMiddlewareOptions,
  InteractionMiddlewareOptions,
  HILMiddlewareOptions,
  LoggingMiddlewareOptions,
  HILResumePayload,
  SummarySettings,
  SummaryOptions,
} from '@core/middleware';
export type {
  GuidelinesOptions,
  GuidelinesSource,
} from '@core/instructions/guidelines';
export type {
  PromptOptions,
  PromptSource,
} from '@core/instructions/prompt';
export type {
  BaseSystemMessageBundle,
  BaseSystemMessageRuntimeData,
} from '@core/instructions/system-message';
export type {SkillsSource} from '@core/skills';

export type {AgentCheckpoint, AgentCheckpointer} from '@core/checkpoint';
