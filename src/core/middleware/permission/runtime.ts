import {ToolMessage} from '@langchain/core/messages';
import {
  applyHILResumeToolEdits,
  parseHILResumeActionPayload,
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
  evaluatePermissionExpression,
  formatPermissionExpression,
} from '@core/middleware/permission/policy';
import type {PermissionPolicyOptions} from '@core/middleware/permission/types';
import {normalizeToolReferenceName} from '@core/tools/names';
import type {PermissionBashAnalysis, PermissionAnalysisModel} from '@core/middleware/permission/analysis';
import {createModelPermissionBashAnalysis} from '@core/middleware/permission/analysis';
import {extractBashAlwaysPatterns, extractBashWritePathOperands} from '@core/middleware/permission/bash';

export interface PermissionRuntimeOptions extends PermissionPolicyOptions {
  bashAnalysisModel?: PermissionAnalysisModel | Promise<PermissionAnalysisModel> | (() => Promise<PermissionAnalysisModel>);
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

function isBashTool(toolName: string): boolean {
  return normalizeToolReferenceName(toolName) === 'bash';
}

/**
 * Convert file expression to directory-level wildcard for session memory.
 * Edit(src/components/Header.tsx) → Edit(src/components/*)
 */
function toDirectoryScopeExpression(expression: string): string {
  const openIndex = expression.indexOf('(');
  if (openIndex < 0) return expression;

  const toolName = expression.slice(0, openIndex);
  const specifier = expression.slice(openIndex + 1, -1);
  const lastSlash = specifier.lastIndexOf('/');

  if (lastSlash < 0) return `${toolName}(*)`;
  return `${toolName}(${specifier.slice(0, lastSlash)}/*)`;
}

/**
 * Check if expression is covered by session memory (supports directory wildcards).
 */
function isSessionAllowed(expression: string, sessionAllowed: Set<string>): boolean {
  if (sessionAllowed.has(expression)) return true;

  const openIndex = expression.indexOf('(');
  if (openIndex < 0) return false;

  const toolName = expression.slice(0, openIndex);
  const specifier = expression.slice(openIndex + 1, -1);

  for (const rule of sessionAllowed) {
    const ruleOpenIndex = rule.indexOf('(');
    if (ruleOpenIndex < 0) continue;

    const ruleTool = rule.slice(0, ruleOpenIndex);
    if (ruleTool !== toolName) continue;

    const ruleSpecifier = rule.slice(ruleOpenIndex + 1, -1);
    if (ruleSpecifier === '*') return true;

    if (ruleSpecifier.endsWith('/*')) {
      const ruleDir = ruleSpecifier.slice(0, -2);
      const specifierDir = specifier.slice(0, specifier.lastIndexOf('/'));
      if (specifierDir === ruleDir) return true;
    }
  }

  return false;
}

/**
 * Generate "always" pattern suggestions for a tool call expression.
 * For Bash: uses BashArity to suggest escalating patterns.
 * For file tools: suggests directory-level patterns.
 */
function generateAlwaysPatterns(expression: string): string[] {
  const openIndex = expression.indexOf('(');
  if (openIndex < 0) return [expression];

  const toolName = expression.slice(0, openIndex);
  const specifier = expression.slice(openIndex + 1, -1);
  const toolNorm = toolName.trim().toLowerCase();

  if (toolNorm === 'bash') {
    return extractBashAlwaysPatterns(specifier).map(p => `Bash(${p})`);
  }

  // File tools: suggest directory-level → tool-level
  if (toolNorm === 'edit' || toolNorm === 'write' || toolNorm === 'read') {
    const patterns: string[] = [];
    const dirExpr = toDirectoryScopeExpression(expression);
    if (dirExpr !== expression) {
      patterns.push(dirExpr);
    }
    patterns.push(`${toolName}(*)`);
    return patterns;
  }

  return [`${toolName}(*)`];
}

/** Pending request waiting for user approval */
interface PendingPermissionRequest {
  context: ToolCallContext;
  expression: string;
}

export function createPermissionRuntime(options: PermissionRuntimeOptions = {}): PermissionRuntime {
  const sessionAllowedExpressions = new Set<string>();
  const pendingRequests = new Map<string, PendingPermissionRequest>();

  // Create bash analysis function if model is provided
  const bashAnalyze = options.bashAnalysisModel
    ? createModelPermissionBashAnalysis({model: options.bashAnalysisModel})
    : undefined;

  return {
    async resolveToolDecision(context) {
      return resolvePermissionDecision(context, options, sessionAllowedExpressions, bashAnalyze, pendingRequests);
    },
    handleResume(metadata, resumePayload, context, handler) {
      return handlePermissionResume(metadata ?? {}, resumePayload, context, handler, options, sessionAllowedExpressions, pendingRequests);
    },
    isPermissionPause,
  };
}

async function resolvePermissionDecision(
  context: ToolCallContext,
  options: PermissionRuntimeOptions,
  sessionAllowed: Set<string>,
  bashAnalyze: ((input: {command: string; cwd?: string; projectRoot?: string}) => Promise<PermissionBashAnalysis | undefined>) | undefined,
  pendingRequests: Map<string, PendingPermissionRequest>,
): Promise<HILDecision | undefined> {
  const evaluation = await evaluatePermissionToolCall(context.toolCall, options);
  if (!evaluation) return undefined;

  // Check session memory first
  if (isSessionAllowed(evaluation.input, sessionAllowed)) {
    return {decision: 'allow'};
  }

  if (evaluation.decision === 'allow') {
    return {decision: 'allow'};
  }

  // Run bash analysis for bash commands
  let bashAnalysis: PermissionBashAnalysis | undefined;
  let reason: string | undefined;
  if (isBashTool(context.toolCall.name)) {
    const args = context.toolCall.args as Record<string, unknown>;
    const command = typeof args?.command === 'string' ? args.command : '';
    if (command) {
      if (bashAnalyze) {
        bashAnalysis = await bashAnalyze({
          command,
          cwd: options.cwd,
          projectRoot: options.projectRoot,
        }).catch(() => undefined);
        reason = bashAnalysis?.reason;
      }

      // Fallback: generate reason from extracted write paths
      if (!reason) {
        const writePaths = extractBashWritePathOperands(command);
        if (writePaths.length > 0) {
          const pathList = writePaths.map(p => p.endsWith('/') ? p : `${p}/`).join(', ');
          reason = `Writes to ${pathList}`;
        }
      }
    }
  }

  // Re-evaluate classifier's pathScopeExpression against existing rules (cross-tool matching)
  let classifierMatch: {bucket: string; rule: string; scope: string; path: string; format: null} | null = null;
  if (bashAnalysis?.pathScopeExpression) {
    const crossEval = await evaluatePermissionExpression(bashAnalysis.pathScopeExpression, options);
    if (crossEval.decision === 'allow') {
      return {decision: 'allow'};
    }
    if (crossEval.matched) {
      classifierMatch = {...crossEval.matched, format: null};
    }
  }

  // Generate suggested "always" patterns
  const alwaysPatterns = generateAlwaysPatterns(evaluation.input);

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
      matched: classifierMatch ?? (evaluation.matchedRule ? {
        bucket: evaluation.matchedRule.action,
        rule: `${evaluation.matchedRule.permission}(${evaluation.matchedRule.pattern})`,
        scope: evaluation.matchedRule.source.scope,
        path: evaluation.matchedRule.source.path,
        format: null,
      } : null),
      reason,
      sources: evaluation.sources,
      ruleSummary: evaluation.ruleSummary,
      alwaysPatterns,
      suggestions: {
        ...(bashAnalysis?.pathScopeExpression ? {pathRule: bashAnalysis.pathScopeExpression} : {}),
        ...(bashAnalysis?.toolScopeExpression ? {toolRule: bashAnalysis.toolScopeExpression} : {}),
      },
    },
  } satisfies Record<string, unknown>;

  if (evaluation.decision === 'deny') {
    return {
      decision: 'deny',
      reason: `Denied by permission policy: ${evaluation.input}`,
      metadata,
    };
  }

  // Store as pending for auto-resolve cascade
  const requestKey = context.toolCall.id || `tool_${context.toolIndex}`;
  pendingRequests.set(requestKey, {context, expression: evaluation.input});

  return {
    decision: 'ask',
    config: createPermissionInterruptConfig(evaluation.input, context, metadata, reason, alwaysPatterns, options, bashAnalysis),
    metadata,
  };
}

function createPermissionInterruptConfig(
  expression: string,
  context: ToolCallContext,
  metadata: Record<string, unknown>,
  _reason: string | undefined,
  _alwaysPatterns: string[],
  _options: PermissionRuntimeOptions,
  _bashAnalysis: PermissionBashAnalysis | undefined,
): HILInterruptConfig {
  // Claude Code style: three actions only — once, always, reject
  const actions: HILUIActionOption[] = [
    {id: 'allow_once', label: 'Allow once', kind: 'primary'},
    {id: 'dont_ask_again', label: 'Allow always', kind: 'secondary'},
    {id: 'deny', label: 'Reject', kind: 'danger'},
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


function extractAlwaysPatterns(metadata: Record<string, unknown>): string[] {
  const policy = metadata.permissionPolicy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return [];
  const patterns = (policy as Record<string, unknown>).alwaysPatterns;
  return Array.isArray(patterns) ? patterns.filter((p): p is string => typeof p === 'string') : [];
}

async function handlePermissionResume(
  _metadata: Record<string, unknown>,
  resumePayload: HILResumePayload,
  context: ToolCallContext,
  handler: (request?: ToolCallContext) => Promise<ToolMessage>,
  options: PermissionRuntimeOptions,
  sessionAllowed: Set<string>,
  pendingRequests: Map<string, PendingPermissionRequest>,
): Promise<ToolMessage> {
  const payload = parseHILResumeActionPayload(resumePayload);

  // Handle reject
  if (payload.action === 'deny' || payload.decision === 'reject') {
    const requestKey = context.toolCall.id || `tool_${context.toolIndex}`;
    pendingRequests.delete(requestKey);
    return createPermissionDenyMessage(context, payload.comment, payload.metadata);
  }

  // Handle "always" — Claude Code style: add ALL always patterns to session memory
  if (payload.action === 'dont_ask_again' || payload.action === 'always') {
    const alwaysPatterns = extractAlwaysPatterns(_metadata);
    if (alwaysPatterns.length > 0) {
      for (const pattern of alwaysPatterns) {
        sessionAllowed.add(pattern);
      }
    } else {
      // Fallback: use the expression itself
      const expression = formatPermissionExpression(context.toolCall);
      if (expression) {
        sessionAllowed.add(expression);
      }
    }

    await autoResolvePendingRequests(options, sessionAllowed, pendingRequests);
  }

  // Clean up pending
  const requestKey = context.toolCall.id || `tool_${context.toolIndex}`;
  pendingRequests.delete(requestKey);

  return handler(context);
}

/**
 * Auto-resolve cascade: after a new "always" rule is added,
 * re-evaluate all pending requests. If any now resolve to "allow",
 * they're automatically approved (OpenCode-style).
 */
async function autoResolvePendingRequests(
  options: PermissionRuntimeOptions,
  sessionAllowed: Set<string>,
  pendingRequests: Map<string, PendingPermissionRequest>,
): Promise<void> {
  const toRemove: string[] = [];

  for (const [key, pending] of pendingRequests) {
    // Check session memory
    if (isSessionAllowed(pending.expression, sessionAllowed)) {
      toRemove.push(key);
      continue;
    }

    // Re-evaluate against updated rules
    const evaluation = await evaluatePermissionToolCall(pending.context.toolCall, options);
    if (evaluation?.decision === 'allow') {
      toRemove.push(key);
    }
  }

  for (const key of toRemove) {
    pendingRequests.delete(key);
  }
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
