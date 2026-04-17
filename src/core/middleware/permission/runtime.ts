/**
 * Permission runtime — resolves tool call decisions and handles resume.
 *
 * Simplified from Claude Code's permissions.ts to Codara's review/interrupt
 * architecture. Session cache, denial tracking, and "always allow" patterns
 * are all handled here.
 */
import {ToolMessage} from '@langchain/core/messages';
import {
  applyReviewResumeToolEdits,
  parseReviewResumeActionPayload,
  type ReviewDecision,
  type ReviewInterruptConfig,
  type ReviewUIActionOption,
  type ReviewResumeHandler,
  type ReviewResumePayload,
  type ReviewToolMessagePayload,
} from '@core/middleware/review';
import type {ToolCallContext} from '@core/pipeline-types';
import {
  evaluatePermissionToolCall,
  formatPermissionExpression,
} from '@core/middleware/permission/policy';
import {persistPermissionRule, persistPermissionScope} from '@core/middleware/permission/policy/persist';
import type {PermissionPolicyOptions} from '@core/middleware/permission/types';
import {normalizeToolReferenceName} from '@shared/tool-names';
import {getToolMetadata} from '@shared/tool-metadata';
import {extractBashAlwaysPatterns, extractBashWritePathOperands} from '@core/middleware/permission/bash-scope';
import {PermissionSessionCache} from '@core/middleware/permission/session-cache';
import {DenialTracker} from '@core/middleware/permission/denial-tracking';

export interface PermissionRuntimeOptions extends PermissionPolicyOptions {}

export interface PermissionRuntime {
  resolveToolDecision(context: ToolCallContext): Promise<ReviewDecision | undefined>;
  handleResume(
    metadata: Record<string, unknown> | undefined,
    resumePayload: ReviewResumePayload,
    context: ToolCallContext,
    handler: (request?: ToolCallContext) => Promise<ToolMessage>,
  ): Promise<ToolMessage>;
  isPermissionReview(metadata: unknown): boolean;
}

const PERMISSION_CHANNEL = 'permission-center';

function isBashTool(name: string): boolean {
  return normalizeToolReferenceName(name) === 'bash';
}

/** Edit(src/components/Header.tsx) -> Edit(src/components/*) */
function toDirectoryScope(expression: string): string {
  const open = expression.indexOf('(');
  if (open < 0) return expression;
  const tool = expression.slice(0, open);
  const spec = expression.slice(open + 1, -1);
  const slash = spec.lastIndexOf('/');
  return slash < 0 ? `${tool}(*)` : `${tool}(${spec.slice(0, slash)}/*)`;
}

function lookupCache(expression: string, cache: PermissionSessionCache) {
  const direct = cache.lookup(expression);
  if (direct !== undefined) return direct;

  const open = expression.indexOf('(');
  if (open < 0) return undefined;
  const tool = expression.slice(0, open);
  const spec = expression.slice(open + 1, -1);

  const toolWild = cache.lookup(`${tool}(*)`);
  if (toolWild !== undefined) return toolWild;

  const slash = spec.lastIndexOf('/');
  if (slash >= 0) {
    const dirWild = cache.lookup(`${tool}(${spec.slice(0, slash)}/*)`);
    if (dirWild !== undefined) return dirWild;
  }
  return undefined;
}

function generateAlwaysPatterns(expression: string): string[] {
  const open = expression.indexOf('(');
  if (open < 0) return [expression];
  const tool = expression.slice(0, open);
  const spec = expression.slice(open + 1, -1);
  const norm = tool.trim().toLowerCase();

  if (norm === 'bash') return extractBashAlwaysPatterns(spec).map(p => `Bash(${p})`);
  if (norm === 'edit' || norm === 'write' || norm === 'read') {
    const patterns: string[] = [];
    const dir = toDirectoryScope(expression);
    if (dir !== expression) patterns.push(dir);
    patterns.push(`${tool}(*)`);
    return patterns;
  }
  return [`${tool}(*)`];
}

export function createPermissionRuntime(options: PermissionRuntimeOptions = {}): PermissionRuntime {
  const sessionCache = new PermissionSessionCache();
  const denialTracker = new DenialTracker();

  return {
    async resolveToolDecision(context) {
      const evaluation = await evaluatePermissionToolCall(context.toolCall, options);
      if (!evaluation) return undefined;

      // Session cache check
      const cached = lookupCache(evaluation.input, sessionCache);
      if (cached === 'allow') return {decision: 'allow'};
      if (cached === 'deny') return {decision: 'deny', reason: `Denied by session cache: ${evaluation.input}`};

      if (evaluation.decision === 'allow') return {decision: 'allow'};

      // Auto-deny on repeated rejections
      if (denialTracker.shouldAutoDeny(context.toolCall.name)) {
        return {decision: 'deny', reason: `Auto-denied after repeated rejections: ${evaluation.input}`};
      }

      // Bash write path detection
      let reason: string | undefined;
      if (isBashTool(context.toolCall.name)) {
        const cmd = typeof (context.toolCall.args as Record<string, unknown>)?.command === 'string'
          ? (context.toolCall.args as Record<string, unknown>).command as string : '';
        if (cmd) {
          const paths = extractBashWritePathOperands(cmd);
          if (paths.length > 0) reason = `Writes to ${paths.map(p => p.endsWith('/') ? p : `${p}/`).join(', ')}`;
        }
      }

      const alwaysPatterns = generateAlwaysPatterns(evaluation.input);
      const toolMeta = getToolMetadata(context.toolCall.name);

      const metadata = {
        codara: {
          actor: {agentType: context.state.agentType ?? 'main'},
          interaction: {kind: 'permission'},
        },
        permissionPolicy: {
          expression: evaluation.input,
          decision: evaluation.decision,
          defaultDecision: evaluation.defaultDecision,
          matched: evaluation.matchedRule ? {
            bucket: evaluation.matchedRule.action,
            rule: `${evaluation.matchedRule.permission}(${evaluation.matchedRule.pattern})`,
            scope: evaluation.matchedRule.source.scope,
            path: evaluation.matchedRule.source.path,
          } : null,
          reason,
          sources: evaluation.sources,
          ruleSummary: evaluation.ruleSummary,
          alwaysPatterns,
          suggestions: {},
          toolMetadata: {
            isReadOnly: toolMeta.isReadOnly,
            isDestructive: toolMeta.isDestructive,
            isConcurrencySafe: toolMeta.isConcurrencySafe,
          },
        },
      } satisfies Record<string, unknown>;

      if (evaluation.decision === 'deny') {
        return {decision: 'deny', reason: `Denied by permission policy: ${evaluation.input}`, metadata};
      }

      const actions: ReviewUIActionOption[] = [
        {id: 'allow_once', label: 'Allow once', kind: 'primary'},
        {id: 'dont_ask_again', label: 'Allow always', kind: 'secondary'},
        {id: 'deny', label: 'Reject', kind: 'danger'},
      ];

      return {
        decision: 'ask',
        config: {
          description: `${context.state.agentType === 'subagent' ? 'Subagent wants to run' : 'Codara wants to run'} ${evaluation.input}`,
          channel: PERMISSION_CHANNEL,
          ui: {tab: 'Security', modal: 'permission-review', actions},
          metadata,
        } satisfies ReviewInterruptConfig,
        metadata,
      };
    },

    async handleResume(meta, resumePayload, context, handler) {
      const payload = parseReviewResumeActionPayload(resumePayload);

      // Reject
      if (payload.action === 'deny' || payload.decision === 'reject') {
        denialTracker.recordDenial(context.toolCall.name);
        return createDenyMessage(context, payload.comment, payload.metadata);
      }

      // Always allow — add patterns to session cache
      if (payload.action === 'dont_ask_again' || payload.action === 'always') {
        const patterns = extractAlwaysPatterns(meta ?? {});
        if (patterns.length > 0) {
          for (const p of patterns) sessionCache.remember(p, 'allow');
        } else {
          const expr = formatPermissionExpression(context.toolCall);
          if (expr) sessionCache.remember(expr, 'allow');
        }

        // Persist to disk
        const expr = formatPermissionExpression(context.toolCall);
        if (expr) {
          const scope = payload.scope as 'exact' | 'path' | 'tool' | 'project' | undefined;
          const persist = scope && scope !== 'exact'
            ? persistPermissionScope(expr, scope, options)
            : persistPermissionRule(expr, 'allow', options);
          await persist.catch(e => console.warn('[permissions] Failed to persist:', e instanceof Error ? e.message : String(e)));
        }
      }

      return handler(context);
    },

    isPermissionReview,
  };
}

function extractAlwaysPatterns(metadata: Record<string, unknown>): string[] {
  const policy = metadata.permissionPolicy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return [];
  const patterns = (policy as Record<string, unknown>).alwaysPatterns;
  return Array.isArray(patterns) ? patterns.filter((p): p is string => typeof p === 'string') : [];
}

export function handlePermissionFallbackResume(
  fallback: ReviewResumeHandler | undefined,
  request: Parameters<ReviewResumeHandler>[0],
  resumePayload: Parameters<ReviewResumeHandler>[1],
  context: Parameters<ReviewResumeHandler>[2],
  handler: Parameters<ReviewResumeHandler>[3],
): Promise<ToolMessage> {
  if (fallback) return fallback(request, resumePayload, context, handler);
  const payload = parseReviewResumeActionPayload(resumePayload);
  if (payload.decision === 'reject') return Promise.resolve(createDenyMessage(context, payload.comment, payload.metadata));
  return handler(applyReviewResumeToolEdits(context, payload));
}

function createDenyMessage(
  context: ToolCallContext,
  reason: string | undefined,
  metadata: Record<string, unknown> | undefined,
): ToolMessage {
  const toolCallId = typeof context.toolCall.id === 'string' && context.toolCall.id.trim()
    ? context.toolCall.id.trim() : `tool_${context.toolIndex}`;

  const payload: ReviewToolMessagePayload = {
    type: 'review_deny',
    reason: reason?.trim() || 'Tool execution denied by user',
    metadata: metadata ?? {},
    action: {toolCallId, toolName: context.toolCall.name},
  };

  return new ToolMessage({
    content: JSON.stringify(payload),
    tool_call_id: toolCallId,
    name: context.toolCall.name,
    status: 'error',
  });
}

export function isPermissionReview(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  return typeof (metadata as Record<string, unknown>).permissionPolicy === 'object';
}
