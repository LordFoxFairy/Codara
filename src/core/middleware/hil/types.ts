// src/core/hil/types.ts

/**
 * HIL 审查类型
 */
export enum HILReviewType {
  PERMISSION = 'permission',
  CODE_REVIEW = 'code-review',
  PLAN_APPROVAL = 'plan-approval',
  CUSTOM = 'custom'
}

/**
 * HIL 审查状态
 */
export enum HILReviewStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled'
}

/**
 * HIL 操作
 */
export interface HILAction {
  id: string;
  label: string;
  kind: 'primary' | 'secondary' | 'danger';
  shortcut?: string;
  description?: string;
}

/**
 * HIL 审查请求
 */
export interface HILReviewRequest {
  id: string;
  type: HILReviewType;
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  actions: HILAction[];
  createdAt: number;
}

/**
 * HIL 审查结果
 */
export interface HILReviewResult {
  reviewId: string;
  actionId: string;
  status: HILReviewStatus;
  payload?: Record<string, unknown>;
  timestamp: number;
}

/**
 * HIL 审查处理器接口
 */
export interface HILReviewHandler<
  TContext = unknown,
  TMetadata = unknown,
  TPayload = unknown
> {
  readonly type: HILReviewType;

  buildReviewRequest(
    context: TContext,
    metadata: TMetadata
  ): HILReviewRequest;

  handleReviewResult(
    request: HILReviewRequest,
    result: HILReviewResult,
    context: TContext
  ): Promise<unknown>;

  renderUI?(review: HILReviewRequest): React.ReactNode;

  validateResult?(result: HILReviewResult): boolean;
}
