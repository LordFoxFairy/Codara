/**
 * 核心常量定义
 */

// 执行限制
export const DEFAULT_RECURSION_LIMIT = 25;
export const DEFAULT_TIMEOUT_MS = 30000;

// Context 键名
export const CODARA_KEY = 'codara';
export const CONTEXT_BUDGET_KEY = 'contextBudget';

// 保留的 Agent Context 键
export const RESERVED_AGENT_CONTEXT_KEYS = new Set(['todos', 'summary']);

// 文件大小限制
export const AGENTS_FILE_MAX_SIZE = 10 * 1024 * 1024; // 10MB
export const AGENTS_FILE_WARN_SIZE = 5 * 1024 * 1024; // 5MB
export const SKILL_FILE_MAX_SIZE = 1 * 1024 * 1024; // 1MB

// 缓存 TTL
export const SKILLS_CACHE_TTL_MS = 5 * 60 * 1000; // 5分钟
export const AGENTS_CACHE_TTL_MS = 5 * 60 * 1000; // 5分钟
