import {ToolMessage} from '@langchain/core/messages';
import {
  applyHILResumeToolEdits,
  parseHILResumeActionPayload,
  type HILDecision,
  type HILInterruptConfig,
  type HILResumeHandler,
  type HILResumePayload,
  type HILToolMessagePayload,
} from '@core/middleware/hil';
import type {ToolCallContext} from '@core/middleware/types';
import {
  evaluatePermissionToolCall,
  formatPermissionExpression,
  persistPermissionRule,
  type PermissionPolicyOptions,
} from '@core/middleware/permission/policy';
import {normalizeToolReferenceName} from '@core/tools/names';

export interface PermissionRuntimeOptions extends PermissionPolicyOptions {}

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

/**
 * 文件修改类工具（Edit/Write）的会话级记忆。
 * 与 Claude Code 一致："Yes, don't ask again" 对文件工具仅当前会话生效，不持久化到文件。
 */
function isBashTool(toolName: string): boolean {
  return normalizeToolReferenceName(toolName) === 'bash';
}

/**
 * 将精确的文件表达式转为目录级通配符。
 * Edit(src/components/Header.tsx) → Edit(src/components/*)
 * Write(package.json)             → Write(*)
 */
function toDirectoryScopeExpression(expression: string): string {
  const openIndex = expression.indexOf('(');
  if (openIndex < 0) {
    return expression;
  }

  const toolName = expression.slice(0, openIndex);
  const specifier = expression.slice(openIndex + 1, -1);
  const lastSlash = specifier.lastIndexOf('/');

  if (lastSlash < 0) {
    return `${toolName}(*)`;
  }

  const directory = specifier.slice(0, lastSlash);
  return `${toolName}(${directory}/*)`;
}

/**
 * 检查表达式是否被会话级记忆覆盖。
 * 支持目录级通配匹配：会话中存的 "Edit(src/components/*)" 可以匹配 "Edit(src/components/Button.tsx)"。
 */
function isSessionAllowed(expression: string, sessionAllowed: Set<string>): boolean {
  if (sessionAllowed.has(expression)) {
    return true;
  }

  const openIndex = expression.indexOf('(');
  if (openIndex < 0) {
    return false;
  }

  const toolName = expression.slice(0, openIndex);
  const specifier = expression.slice(openIndex + 1, -1);

  for (const rule of sessionAllowed) {
    const ruleOpenIndex = rule.indexOf('(');
    if (ruleOpenIndex < 0) {
      continue;
    }

    const ruleTool = rule.slice(0, ruleOpenIndex);
    if (ruleTool !== toolName) {
      continue;
    }

    const ruleSpecifier = rule.slice(ruleOpenIndex + 1, -1);
    if (ruleSpecifier === '*') {
      return true;
    }

    if (ruleSpecifier.endsWith('/*')) {
      const ruleDir = ruleSpecifier.slice(0, -2);
      const specifierDir = specifier.slice(0, specifier.lastIndexOf('/'));
      if (specifierDir === ruleDir) {
        return true;
      }
    }
  }

  return false;
}


export function createPermissionRuntime(options: PermissionRuntimeOptions = {}): PermissionRuntime {
  const sessionAllowedExpressions = new Set<string>();

  return {
    resolveToolDecision(context) {
      return resolvePermissionDecision(context, options, sessionAllowedExpressions);
    },
    handleResume(metadata, resumePayload, context, handler) {
      return handlePermissionResume(metadata ?? {}, resumePayload, context, handler, options, sessionAllowedExpressions);
    },
    isPermissionPause,
  };
}

async function resolvePermissionDecision(
  context: ToolCallContext,
  options: PermissionRuntimeOptions,
  sessionAllowed: Set<string>,
): Promise<HILDecision | undefined> {
  const evaluation = await evaluatePermissionToolCall(context.toolCall, options);
  if (!evaluation) {
    return undefined;
  }

  if (isSessionAllowed(evaluation.input, sessionAllowed)) {
    return {decision: 'allow'};
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
    config: createPermissionInterruptConfig(evaluation.input, context, metadata),
    metadata,
  };
}

function createPermissionInterruptConfig(
  expression: string,
  context: ToolCallContext,
  metadata: Record<string, unknown>,
): HILInterruptConfig {
  const actions = [
    {
      id: 'allow_once',
      label: 'Yes',
      kind: 'primary' as const,
    },
    {
      id: 'dont_ask_again',
      label: "Yes, don't ask again",
      kind: 'secondary' as const,
    },
    {
      id: 'deny',
      label: 'No',
      kind: 'danger' as const,
    },
  ];

  return {
    description: `${context.state.agentType === 'subagent' ? 'Subagent wants to run' : 'Codara wants to run'} ${expression}`,
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
  _metadata: Record<string, unknown>,
  resumePayload: HILResumePayload,
  context: ToolCallContext,
  handler: (request?: ToolCallContext) => Promise<ToolMessage>,
  options: PermissionRuntimeOptions,
  sessionAllowed: Set<string>,
): Promise<ToolMessage> {
  const payload = parseHILResumeActionPayload(resumePayload);
  if (payload.action === 'deny' || payload.decision === 'reject') {
    return createPermissionDenyMessage(context, payload.comment, payload.metadata);
  }

  if (payload.action === 'dont_ask_again') {
    const expression = formatPermissionExpression(context.toolCall);
    if (expression) {
      if (isBashTool(context.toolCall.name)) {
        // Bash: 精确命令持久化到 settings.local.json（跨会话）
        await persistPermissionRule(expression, 'allow', options);
      } else {
        // Edit/Write 等: 目录级会话记忆，不持久化
        sessionAllowed.add(toDirectoryScopeExpression(expression));
      }
    }
  }

  return handler(context);
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

