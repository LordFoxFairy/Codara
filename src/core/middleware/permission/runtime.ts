import {ToolMessage} from '@langchain/core/messages';
import {
  applyHILResumeToolEdits,
  parseHILResumeActionPayload,
  type HILResumeActionPayload,
  type HILDecision,
  type HILInterruptConfig,
  type HILUIActionOption,
  type HILResumeHandler,
  type HILResumePayload,
  type HILToolMessagePayload,
} from '@core/middleware/hil';
import type {ToolCallContext} from '@core/middleware/types';
import {
  evaluatePermissionToolCall,
  formatPermissionPathScopeExpression,
  persistPermissionScope,
  type PermissionGrantScope,
  type PermissionPolicyOptions,
} from '@core/middleware/permission/policy';

export interface PermissionRuntimeOptions extends PermissionPolicyOptions {
  includeEditAction?: boolean;
}

export interface PermissionRuntime {
  resolveToolDecision(context: ToolCallContext): Promise<HILDecision | undefined>;
  handleResume(
    metadata: Record<string, unknown> | undefined,
    resumePayload: HILResumePayload,
    context: ToolCallContext,
    handler: (request?: ToolCallContext) => Promise<ToolMessage>,
  ): Promise<ToolMessage>;
  isPermissionPause(metadata: unknown): boolean;
}

const DEFAULT_PERMISSION_CHANNEL = 'permission-center';

export function createPermissionRuntime(options: PermissionRuntimeOptions = {}): PermissionRuntime {
  return {
    resolveToolDecision(context) {
      return resolvePermissionDecision(context, options);
    },
    handleResume(metadata, resumePayload, context, handler) {
      return handlePermissionResume(metadata ?? {}, resumePayload, context, handler, options);
    },
    isPermissionPause,
  };
}

async function resolvePermissionDecision(
  context: ToolCallContext,
  options: PermissionRuntimeOptions,
): Promise<HILDecision | undefined> {
  const evaluation = await evaluatePermissionToolCall(context.toolCall, options);
  if (!evaluation) {
    return undefined;
  }

  const metadata = {
    codara: {
      actor: {
        agentType: context.state.agentType ?? 'main',
      },
    },
    permissionPolicy: {
      expression: evaluation.input,
      decision: evaluation.decision,
      defaultDecision: evaluation.defaultDecision,
      matched: evaluation.matched,
      sources: evaluation.sources,
      policySummary: evaluation.policySummary,
    },
  } satisfies Record<string, unknown>;

  if (evaluation.decision === 'allow') {
    return {decision: 'allow'};
  }

  if (evaluation.decision === 'deny') {
    return {
      decision: 'deny',
      reason: `Denied by permission policy: ${evaluation.input}`,
      metadata,
    };
  }

  return {
    decision: 'ask',
    config: createPermissionInterruptConfig(evaluation.input, context, options, metadata),
    metadata,
  };
}

function createPermissionInterruptConfig(
  expression: string,
  context: ToolCallContext,
  options: PermissionRuntimeOptions,
  metadata: Record<string, unknown>,
): HILInterruptConfig {
  const permissionKind = resolvePermissionReviewKind(context.toolCall.name);
  const pathAction = buildPermissionPathAction(context, options);
  const genericApprovalActions = [
    {
      id: 'always',
      label: 'Always allow this action',
      kind: 'secondary' as const,
      scope: 'exact',
      description: 'Persist only this exact permission expression.',
    },
    {
      id: 'allow_tool',
      label: 'Allow this command type',
      kind: 'secondary' as const,
      scope: 'tool',
      description: 'Persist a wildcard rule for similar commands in this project.',
    },
    {
      id: 'allow_project',
      label: 'Trust this project',
      kind: 'secondary' as const,
      scope: 'project',
      description: 'Set the project permission default to allow.',
    },
  ];
  const actions = [
    {
      id: 'allow_once',
      label: 'Allow once',
      kind: 'primary' as const,
      description: 'Approve only this execution.',
    },
    ...(pathAction ? [pathAction] : permissionKind === 'path' ? [] : genericApprovalActions),
    ...(pathAction && permissionKind !== 'path' ? genericApprovalActions.slice(1) : []),
    ...(options.includeEditAction === false ? [] : [{
      id: 'edit',
      label: 'Edit and continue',
      kind: 'secondary' as const,
      requiresToolEdit: true,
    }]),
    {id: 'deny', label: 'Deny', kind: 'danger' as const, requiresConfirmation: true},
  ];

  return {
    description: `${context.state.agentType === 'subagent' ? 'Delegated subagent permission review required' : 'Permission review required'} for ${expression}`,
    channel: DEFAULT_PERMISSION_CHANNEL,
    ui: {
      tab: 'Security',
      modal: 'permission-review',
      actions,
    },
    metadata,
  };
}

async function handlePermissionResume(
  metadata: Record<string, unknown>,
  resumePayload: HILResumePayload,
  context: ToolCallContext,
  handler: (request?: ToolCallContext) => Promise<ToolMessage>,
  options: PermissionRuntimeOptions,
): Promise<ToolMessage> {
  const payload = parseHILResumeActionPayload(resumePayload);
  if (payload.action === 'deny' || payload.decision === 'reject') {
    return createPermissionDenyMessage(context, payload.comment, payload.metadata);
  }

  const nextContext = applyHILResumeToolEdits(context, payload);
  const grantScope = resolvePermissionGrantScope(payload);
  if (grantScope) {
    await persistPermissionScope(nextContext.toolCall, grantScope, options);
  }

  if (
    payload.action === 'allow_once'
    || payload.action === 'always'
    || payload.action === 'edit'
    || payload.decision === 'approve'
    || payload.decision === 'edit'
    || payload.action === 'allow'
    || payload.action === undefined
  ) {
    return handler(nextContext);
  }

  return createPermissionDenyMessage(context, `Unsupported permission action: ${payload.action}`, metadata);
}

export function handlePermissionFallbackResume(
  fallback: HILResumeHandler | undefined,
  request: Parameters<HILResumeHandler>[0],
  resumePayload: Parameters<HILResumeHandler>[1],
  context: Parameters<HILResumeHandler>[2],
  handler: Parameters<HILResumeHandler>[3],
): Promise<ToolMessage> {
  if (fallback) {
    return fallback(request, resumePayload, context, handler);
  }

  const payload = parseHILResumeActionPayload(resumePayload);
  if (payload.decision === 'reject') {
    return Promise.resolve(createPermissionDenyMessage(context, payload.comment, payload.metadata));
  }

  return handler(applyHILResumeToolEdits(context, payload));
}

function createPermissionDenyMessage(
  context: ToolCallContext,
  reason: string | undefined,
  metadata: Record<string, unknown> | undefined,
): ToolMessage {
  const toolCallId = typeof context.toolCall.id === 'string' && context.toolCall.id.trim()
    ? context.toolCall.id.trim()
    : `tool_${context.toolIndex}`;

  const payload: HILToolMessagePayload = {
    type: 'hil_deny',
    reason: reason?.trim() || 'Tool execution denied by user',
    metadata: metadata ?? {},
    action: {
      toolCallId,
      toolName: context.toolCall.name,
    },
  };

  return new ToolMessage({
    content: JSON.stringify(payload),
    tool_call_id: toolCallId,
    name: context.toolCall.name,
    status: 'error',
  });
}

export function isPermissionPause(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }

  return typeof (metadata as Record<string, unknown>).permissionPolicy === 'object';
}

type PermissionReviewKind = 'path' | 'command';

function resolvePermissionReviewKind(toolName: string): PermissionReviewKind {
  const normalized = toolName.trim().toLowerCase();
  return normalized === 'read_file' || normalized === 'write_file' || normalized === 'edit_file'
    ? 'path'
    : 'command';
}

function buildPermissionPathAction(
  context: ToolCallContext,
  options: PermissionRuntimeOptions,
): HILUIActionOption | undefined {
  const expression = formatPermissionPathScopeExpression(context.toolCall, options);
  const target = readPermissionPathScopeTarget(expression);
  if (!target || target === './') {
    return undefined;
  }

  const label = target
    ? `Yes, and always allow access to ${target} from this project`
    : 'Yes, and always allow access to this path from this project';

  return {
    id: 'allow_path',
    label,
    kind: 'secondary',
    scope: 'path',
    description: 'Persist a path rule for this project subtree.',
  };
}

function resolvePermissionGrantScope(payload: HILResumeActionPayload): PermissionGrantScope | undefined {
  const scope = payload.scope?.trim().toLowerCase();
  if (scope === 'exact' || scope === 'path' || scope === 'tool' || scope === 'project') {
    return scope;
  }

  const action = payload.action?.trim().toLowerCase();
  if (action === 'always') {
    return 'exact';
  }
  if (action === 'allow_path') {
    return 'path';
  }
  if (action === 'allow_tool') {
    return 'tool';
  }
  if (action === 'allow_project') {
    return 'project';
  }

  if (payload.decision !== 'approve' && payload.decision !== 'edit') {
    return undefined;
  }

  return undefined;
}

function readPermissionPathScopeTarget(expression: string | undefined): string | undefined {
  if (!expression) {
    return undefined;
  }

  const open = expression.indexOf('(');
  if (open < 0 || !expression.endsWith(')')) {
    return undefined;
  }

  const target = expression.slice(open + 1, -1).trim();
  if (!target) {
    return undefined;
  }

  return target;
}
