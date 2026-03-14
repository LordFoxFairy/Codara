// src/core/permission/types.ts

/**
 * 权限决策
 */
export type PermissionDecision = 'allow' | 'ask' | 'deny';

/**
 * 工具调用
 */
export interface ToolCall {
  tool: string;
  input: string;
  args?: unknown[];
}

/**
 * 解析后的工具表达式
 */
export interface ParsedToolExpression {
  tool: string;
  specifier: string;
}

/**
 * 权限规则匹配结果
 */
export interface PermissionRuleMatch {
  bucket: 'deny' | 'ask' | 'allow';
  rule: string;
  scope: string;
}

/**
 * 策略来源信息
 */
export interface PermissionSourceInfo {
  scope: 'explicit' | 'codara_local' | 'codara_project' | 'codara_user';
  path: string;
  exists: boolean;
  format: string | null;
}

/**
 * 权限评估结果
 */
export interface PermissionEvaluationResult {
  input: string;
  decision: PermissionDecision;
  matched: PermissionRuleMatch | null;
  defaultDecision: PermissionDecision;
  sources: PermissionSourceInfo[];
  policySummary: {
    deny: number;
    ask: number;
    allow: number;
  };
}

/**
 * 权限规则
 */
export interface PermissionRule {
  expression: string;
  bucket: 'deny' | 'ask' | 'allow';
  source: PermissionSourceInfo;
}

/**
 * 合并后的策略
 */
export interface MergedPermissionPolicy {
  deny: PermissionRule[];
  ask: PermissionRule[];
  allow: PermissionRule[];
  defaultDecision: PermissionDecision;
  sources: PermissionSourceInfo[];
  summary: {
    deny: number;
    ask: number;
    allow: number;
  };
}

/**
 * 策略选项
 */
export interface PermissionPolicyOptions {
  policyFiles?: string[];
  projectRoot?: string;
  userHome?: string;
  policies?: any[];
}

/**
 * 文件操作
 */
export interface FileOperation {
  type: 'read' | 'write' | 'delete';
  path: string;
  tool: 'Read' | 'Write';
}

/**
 * 命令复杂度
 */
export interface CommandComplexity {
  hasRedirect: boolean;
  hasPipe: boolean;
  hasSubshell: boolean;
}

/**
 * 风险级别
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Bash 分析结果
 */
export interface BashAnalysisResult {
  command: string;
  normalized: string;
  risk: RiskLevel;
  operations: FileOperation[];
  complexity: CommandComplexity;
}

/**
 * 权限错误
 */
export class PermissionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'PermissionError';
  }
}

/**
 * 权限拒绝错误
 */
export class PermissionDeniedError extends PermissionError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, 'PERMISSION_DENIED', metadata);
    this.name = 'PermissionDeniedError';
  }
}

/**
 * 策略加载错误
 */
export class PolicyLoadError extends PermissionError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, 'POLICY_LOAD_ERROR', metadata);
    this.name = 'PolicyLoadError';
  }
}
