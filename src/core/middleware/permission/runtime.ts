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
  formatPermissionToolScopeExpression,
  persistPermissionRule,
  persistPermissionScope,
  type PermissionGrantScope,
  type PermissionPolicyOptions,
} from '@core/middleware/permission/policy';
import type {PermissionBashClassification, PermissionBashClassifier} from '@core/middleware/permission/classifier';

export interface PermissionRuntimeOptions extends PermissionPolicyOptions {
  includeEditAction?: boolean;
  bashClassifier?: PermissionBashClassifier;
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

  const bashClassification = await classifyBashPermission(context, evaluation.decision, options);
  const reason = describePermissionDecisionReason(evaluation, context, options);
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
      reason: bashClassification?.reason ?? reason,
      sources: evaluation.sources,
      policySummary: evaluation.policySummary,
      suggestions: {
        ...(bashClassification?.pathScopeExpression ? {pathRule: bashClassification.pathScopeExpression} : {}),
        ...(bashClassification?.toolScopeExpression ? {toolRule: bashClassification.toolScopeExpression} : {}),
      },
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
    config: createPermissionInterruptConfig(
      evaluation.input,
      context,
      options,
      metadata,
      bashClassification?.reason ?? reason,
      bashClassification,
    ),
    metadata,
  };
}

function createPermissionInterruptConfig(
  expression: string,
  context: ToolCallContext,
  options: PermissionRuntimeOptions,
  metadata: Record<string, unknown>,
  reason: string | undefined,
  bashClassification?: PermissionBashClassification,
): HILInterruptConfig {
  const permissionKind = resolvePermissionReviewKind(context.toolCall.name);
  const pathAction = buildPermissionPathAction(context, options, bashClassification);
  const toolAction = pathAction && permissionKind === 'command'
    ? undefined
    : buildPermissionToolAction(context.toolCall, bashClassification);
  const genericApprovalActions = [
    {
      id: 'always',
      label: 'Always allow this action',
      kind: 'secondary' as const,
      scope: 'exact',
      description: 'Persist only this exact permission expression.',
    },
    ...(toolAction ? [toolAction] : []),
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
    ...(pathAction && permissionKind !== 'path'
      ? genericApprovalActions.filter((action) => action.id !== 'always')
      : []),
    ...(options.includeEditAction === false ? [] : [{
      id: 'edit',
      label: 'Edit and continue',
      kind: 'secondary' as const,
      requiresToolEdit: true,
    }]),
    {id: 'deny', label: 'Deny', kind: 'danger' as const, requiresConfirmation: true},
  ];

  return {
    description: reason ?? `${context.state.agentType === 'subagent' ? 'Delegated subagent permission review required' : 'Permission review required'} for ${expression}`,
    channel: DEFAULT_PERMISSION_CHANNEL,
    ui: {
      tab: 'Security',
      modal: 'permission-review',
      actions,
    },
    metadata,
  };
}

function describePermissionDecisionReason(
  evaluation: Awaited<ReturnType<typeof evaluatePermissionToolCall>>,
  context: ToolCallContext,
  options: PermissionRuntimeOptions,
): string | undefined {
  if (!evaluation) {
    return undefined;
  }

  if (evaluation.decision === 'deny') {
    if (evaluation.matched?.rule) {
      return `Denied because this action matches ${evaluation.matched.rule}.`;
    }
    return `Denied by permission policy for ${evaluation.input}.`;
  }

  if (evaluation.decision !== 'ask') {
    return undefined;
  }

  if (evaluation.matched?.bucket === 'ask' && evaluation.matched.rule) {
    return `Needs approval because it matches ${evaluation.matched.rule}.`;
  }

  const pathTarget = readPermissionPathScopeTarget(formatPermissionPathScopeExpression(context.toolCall, options));
  if (pathTarget && pathTarget !== './') {
    return `Needs approval because no allow rule covers access to ${pathTarget}.`;
  }

  const toolScope = formatPermissionToolScopeExpression(context.toolCall);
  if (toolScope && toolScope !== 'Bash(*)') {
    const target = readPermissionToolScopeTarget(toolScope);
    if (target && target !== '*') {
      return `Needs approval because no allow rule covers ${target}.`;
    }
  }

  return 'Needs approval because no allow rule covers this action.';
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
    const suggestedRule = resolveSuggestedPermissionRule(metadata, grantScope);
    if (suggestedRule) {
      await persistPermissionRule(suggestedRule, 'allow', options);
    } else {
      await persistPermissionScope(nextContext.toolCall, grantScope, options);
    }
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
  bashClassification?: PermissionBashClassification,
): HILUIActionOption | undefined {
  const expression = bashClassification?.pathScopeExpression ?? formatPermissionPathScopeExpression(context.toolCall, options);
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

function buildPermissionToolAction(
  toolCall: ToolCallContext['toolCall'],
  bashClassification?: PermissionBashClassification,
): HILUIActionOption {
  const expression = bashClassification?.toolScopeExpression ?? formatPermissionToolScopeExpression(toolCall);

  return {
    id: 'allow_tool',
    label: describePermissionToolScopeLabel(toolCall.name ?? '', expression),
    kind: 'secondary',
    scope: 'tool',
    description: expression
      ? `Persist a project rule for ${expression}.`
      : 'Persist a wildcard rule for similar commands in this project.',
  };
}

function describePermissionToolScopeLabel(toolName: string, expression: string | undefined): string {
  if (toolName.trim().toLowerCase() !== 'bash') {
    return 'Allow this command type';
  }

  if (!expression || expression === 'Bash(*)') {
    return 'Yes, and allow bash commands in this project';
  }

  const target = readPermissionToolScopeTarget(expression);
  if (!target || target === '*') {
    return 'Yes, and allow bash commands in this project';
  }

  const normalized = target.replace(/\s+\*$/, '').trim();
  if (!normalized) {
    return 'Yes, and allow bash commands in this project';
  }

  return `Yes, and allow ${normalized} commands in this project`;
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

async function classifyBashPermission(
  context: ToolCallContext,
  decision: 'allow' | 'ask' | 'deny',
  options: PermissionRuntimeOptions,
): Promise<PermissionBashClassification | undefined> {
  if (decision !== 'ask' || context.toolCall.name.trim().toLowerCase() !== 'bash' || !options.bashClassifier) {
    return undefined;
  }

  const command = readBashCommand(context.toolCall);
  if (!command) {
    return undefined;
  }

  try {
    return await options.bashClassifier({
      command,
      cwd: options.cwd,
      projectRoot: options.projectRoot,
    });
  } catch {
    return undefined;
  }
}

function readBashCommand(toolCall: ToolCallContext['toolCall']): string | undefined {
  const args = toolCall.args;
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }

  const command = (args as Record<string, unknown>).command;
  return typeof command === 'string' && command.trim().length > 0 ? command.trim() : undefined;
}

function resolveSuggestedPermissionRule(
  metadata: Record<string, unknown>,
  scope: PermissionGrantScope,
): string | undefined {
  const suggestions = readPermissionSuggestions(metadata);
  if (scope === 'path') {
    return suggestions?.pathRule;
  }
  if (scope === 'tool') {
    return suggestions?.toolRule;
  }
  return undefined;
}

function readPermissionSuggestions(
  metadata: Record<string, unknown>,
): {pathRule?: string; toolRule?: string} | undefined {
  const permissionPolicy = metadata.permissionPolicy;
  if (!permissionPolicy || typeof permissionPolicy !== 'object' || Array.isArray(permissionPolicy)) {
    return undefined;
  }

  const suggestions = (permissionPolicy as Record<string, unknown>).suggestions;
  if (!suggestions || typeof suggestions !== 'object' || Array.isArray(suggestions)) {
    return undefined;
  }

  const pathRule = typeof (suggestions as Record<string, unknown>).pathRule === 'string'
    ? (suggestions as Record<string, string>).pathRule.trim()
    : undefined;
  const toolRule = typeof (suggestions as Record<string, unknown>).toolRule === 'string'
    ? (suggestions as Record<string, string>).toolRule.trim()
    : undefined;

  return pathRule || toolRule ? { ...(pathRule ? {pathRule} : {}), ...(toolRule ? {toolRule} : {}) } : undefined;
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

function readPermissionToolScopeTarget(expression: string | undefined): string | undefined {
  return readPermissionPathScopeTarget(expression);
}
