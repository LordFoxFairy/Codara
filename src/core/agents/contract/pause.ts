/**
 * Agent 暂停/恢复核心类型。
 *
 * 暂停（pause/resume）是 agent 运行时的核心能力，
 * 类似 LangGraph 的 interrupt/resume 定义在执行引擎层。
 * HIL middleware 只是暂停的一种实现方式。
 */

/**
 * 暂停时携带的动作描述。
 */
export interface PauseActionDescriptor {
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
}

/**
 * UI 交互选项（opaque，由调用方定义语义）。
 */
export interface PauseUIActionOption {
  id: string;
  label: string;
  kind?: 'primary' | 'secondary' | 'danger';
  description?: string;
  requiresConfirmation?: boolean;
  requiresToolEdit?: boolean;
}

export interface PauseUIConfig {
  tab?: string;
  modal?: string;
  actions?: PauseUIActionOption[];
  [key: string]: unknown;
}

export type PauseReviewDecision = 'approve' | 'edit' | 'reject';

export interface PauseReviewRequest {
  actionName: string;
  allowedDecisions: PauseReviewDecision[];
}

/**
 * Agent 暂停请求。
 *
 * 当 agent 需要外部输入（如人工审批）时产生。
 * 对应 LangGraph 的 interrupt() 返回值。
 */
export interface PauseRequest {
  id: string;
  description: string;
  action: PauseActionDescriptor;
  review: PauseReviewRequest;
  runtime: {
    runId: string;
    turn: number;
    requestId: string;
    toolIndex: number;
  };
  channel?: string;
  ui?: PauseUIConfig;
  metadata?: Record<string, unknown>;
}

/**
 * 恢复暂停时的载荷（opaque，由调用方决定内容）。
 */
export type ResumePayload = unknown;
