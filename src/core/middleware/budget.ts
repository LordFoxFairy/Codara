// src/core/middleware/budget.ts

/**
 * Budget Middleware - Token 使用量管理
 */

export interface BudgetConfig {
  maxTokens?: number;
  warningThreshold?: number;
}

export interface BudgetState {
  used: number;
  limit: number;
  remaining: number;
}

// TODO: 实现 budget middleware
