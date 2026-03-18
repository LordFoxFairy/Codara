import {ToolMessage, type ToolCall} from '@langchain/core/messages';
import {createMiddleware, readExecutionMetadata, type ToolCallContext} from '@engine/pipeline/types';
import type {
  PauseActionDescriptor,
  PauseRequest,
  PauseReviewDecision,
  PauseReviewRequest,
  PauseUIActionOption,
  PauseUIConfig,
  ResumePayload,
} from '@shared/contracts/agent-types';

export type HILActionDescriptor = PauseActionDescriptor;
export type HILPauseRequest = PauseRequest;
export type HILReviewDecision = PauseReviewDecision;
export type HILReviewRequest = PauseReviewRequest;
export type HILUIActionOption = PauseUIActionOption;
export type HILResumePayload = ResumePayload;

export type HILToolMessagePayload =
  | {
      type: 'hil_pause';
      request: PauseRequest;
    }
  | {
      type: 'hil_deny';
      reason: string;
      metadata: Record<string, unknown>;
      action: {
        toolCallId: string;
        toolName: string;
      };
    };

export type HILDescriptionFactory = (
  toolCall: ToolCall,
  state: ToolCallContext['state'],
  runtime: ToolCallContext['runtime']
) => string | Promise<string>;

export interface HILInterruptConfig {
  description?: string | HILDescriptionFactory;
  channel?: string;
  ui?: PauseUIConfig;
  metadata?: Record<string, unknown>;
  allowedDecisions?: PauseReviewDecision[];
}

export type HILInterruptOn = Record<string, boolean | HILInterruptConfig>;

export interface HILContextConfig {
  interruptOn?: HILInterruptOn;
  descriptionPrefix?: string;
}

/**
 * Generic resume payload shape used by higher-level interaction layers.
 * `scope` is intentionally opaque to HIL so approval persistence can stay
 * in project policy or other external stores.
 */
export interface HILResumeActionPayload {
  decision?: PauseReviewDecision;
  action?: string;
  scope?: string;
  comment?: string;
  editedToolName?: string;
  editedToolArgs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface HILEffectiveConfig {
  interruptOn?: HILInterruptOn;
  descriptionPrefix: string;
}

export interface HILDecisionContext {
  context: ToolCallContext;
  effectiveConfig: HILEffectiveConfig;
  interruptConfig: HILInterruptConfig | null;
}

export interface HILAllowDecision {
  decision: 'allow';
}

export interface HILAskDecision {
  decision: 'ask';
  config?: HILInterruptConfig;
  metadata?: Record<string, unknown>;
}

export interface HILDenyDecision {
  decision: 'deny';
  reason?: string;
  metadata?: Record<string, unknown>;
  message?: ToolMessage;
}

export type HILDecision = HILAllowDecision | HILAskDecision | HILDenyDecision;

export type HILDecisionResolver = (
  input: HILDecisionContext
) => Promise<HILDecision | undefined> | HILDecision | undefined;

export type HILPauseRequestFactory = (
  context: ToolCallContext,
  config: HILInterruptConfig,
  descriptionPrefix: string
) => Promise<PauseRequest> | PauseRequest;

export type HILPauseNotifier = (request: PauseRequest, context: ToolCallContext) => Promise<void> | void;

export type HILResumeResolver = (
  request: PauseRequest,
  context: ToolCallContext
) => Promise<ResumePayload | undefined> | ResumePayload | undefined;

export type HILResumeHandler = (
  request: PauseRequest,
  resumePayload: ResumePayload,
  context: ToolCallContext,
  handler: (request?: ToolCallContext) => Promise<ToolMessage>
) => Promise<ToolMessage>;

export type HILPauseMessageFactory = (request: PauseRequest, context: ToolCallContext) => ToolMessage;

export type HILDenyMessageFactory = (decision: HILDenyDecision, context: ToolCallContext) => ToolMessage;

export interface HILMiddlewareOptions extends HILContextConfig {
  enabled?: boolean;
  name?: string;
  resolveDecision?: HILDecisionResolver;
  buildPauseRequest?: HILPauseRequestFactory;
  onPause?: HILPauseNotifier;
  resolveResume?: HILResumeResolver;
  handleResume?: HILResumeHandler;
  createPauseMessage?: HILPauseMessageFactory;
  createDenyMessage?: HILDenyMessageFactory;
}

const DEFAULT_NAME = 'HumanInTheLoopMiddleware';
const DEFAULT_DESCRIPTION_PREFIX = 'Tool execution paused for human interaction';
const DEFAULT_ALLOWED_DECISIONS: PauseReviewDecision[] = ['approve', 'edit', 'reject'];

/**
 * Generic Human-in-the-Loop middleware.
 *
 * Design goal:
 * - Middleware is only responsible for pause/resume interception.
 * - Any concrete interaction protocol (approval/edit/reject, multipage UI, tab workflow)
 *   is implemented outside via `resolveDecision` / `resolveResume` / `handleResume` hooks.
 */
export function createHILMiddleware(options: HILMiddlewareOptions = {}) {
  const name = options.name?.trim() || DEFAULT_NAME;
  const enabled = options.enabled ?? true;

  const resolveDecision = options.resolveDecision ?? defaultDecisionResolver;
  const buildPauseRequest = options.buildPauseRequest ?? defaultPauseRequestFactory;
  const onPause = options.onPause ?? noopPauseNotifier;
  const resolveResume = options.resolveResume ?? defaultResumeResolver;
  const createPauseMessage = options.createPauseMessage ?? defaultPauseMessageFactory;
  const createDenyMessage = options.createDenyMessage ?? defaultDenyMessageFactory;
  const handleResume = options.handleResume ?? createDefaultResumeHandler(createDenyMessage);

  return createMiddleware({
    name,
    async wrapToolCall(context, handler) {
      if (!enabled) {
        return handler(context);
      }

      const effectiveConfig = resolveEffectiveConfig(options, context.runtime.context);
      const interruptConfig = resolveInterruptConfig(context.toolCall.name, effectiveConfig.interruptOn);

      const decisionInput: HILDecisionContext = {
        context,
        effectiveConfig,
        interruptConfig,
      };
      const rawDecision = await resolveDecision(decisionInput);
      const decision = normalizeDecision(rawDecision, interruptConfig);

      if (decision.decision === 'allow') {
        return handler(context);
      }

      if (decision.decision === 'deny') {
        return decision.message ?? createDenyMessage(decision, context);
      }

      const askConfig = resolveAskConfig(decision, interruptConfig);
      const pauseRequest = await buildPauseRequest(context, askConfig, effectiveConfig.descriptionPrefix);
      const resumePayload = await resolveResume(pauseRequest, context);

      if (resumePayload !== undefined) {
        return handleResume(pauseRequest, resumePayload, context, handler);
      }

      await onPause(pauseRequest, context);
      return createPauseMessage(pauseRequest, context);
    },
  });
}

/** `createHILMiddleware` 的语义化别名。 */

function resolveEffectiveConfig(options: HILMiddlewareOptions, runtimeContext: unknown): HILEffectiveConfig {
  const hil = readHILContext(runtimeContext);
  return {
    interruptOn: isInterruptOn(hil.interruptOn) ? hil.interruptOn : options.interruptOn,
    descriptionPrefix: readOptionalString(hil.descriptionPrefix) ?? options.descriptionPrefix ?? DEFAULT_DESCRIPTION_PREFIX,
  };
}

function resolveInterruptConfig(toolName: string, interruptOn: HILInterruptOn | undefined): HILInterruptConfig | null {
  if (!interruptOn) {
    return null;
  }

  const direct = interruptOn[toolName];
  const rawValue: unknown = direct ?? findPatternConfig(toolName, interruptOn);
  if (rawValue === undefined || rawValue === false) {
    return null;
  }

  if (rawValue === true) {
    return {};
  }

  if (!isInterruptConfig(rawValue)) {
    throw new Error(`Invalid interruptOn config for tool "${toolName}"`);
  }

  return {
    ...(rawValue.description !== undefined ? {description: rawValue.description} : {}),
    ...(rawValue.channel !== undefined ? {channel: rawValue.channel} : {}),
    ...(rawValue.ui !== undefined ? {ui: rawValue.ui} : {}),
    ...(rawValue.metadata !== undefined ? {metadata: rawValue.metadata} : {}),
    ...(rawValue.allowedDecisions !== undefined ? {allowedDecisions: [...rawValue.allowedDecisions]} : {}),
  };
}

function findPatternConfig(toolName: string, interruptOn: HILInterruptOn): boolean | HILInterruptConfig | undefined {
  for (const [pattern, config] of Object.entries(interruptOn)) {
    if (pattern === toolName) {
      continue;
    }
    if (matchesPattern(toolName, pattern)) {
      return config;
    }
  }
  return undefined;
}

function matchesPattern(value: string, pattern: string): boolean {
  if (!pattern) {
    return false;
  }

  if (pattern === '*') {
    return true;
  }

  if (!pattern.includes('*')) {
    return value.toLowerCase() === pattern.toLowerCase();
  }

  const escaped = pattern
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*/g, '.*');

  const regex = new RegExp(`^${escaped}$`, 'i');
  return regex.test(value);
}

function normalizeDecision(
  decision: HILDecision | undefined,
  interruptConfig: HILInterruptConfig | null
): HILDecision {
  if (!decision) {
    if (!interruptConfig) {
      return {decision: 'allow'};
    }
    return {decision: 'ask', config: interruptConfig};
  }

  if (decision.decision === 'allow' || decision.decision === 'deny') {
    return decision;
  }

  if (decision.decision === 'ask') {
    return {
      ...decision,
      config: resolveAskConfig(decision, interruptConfig),
    };
  }

  throw new Error(`Unsupported HIL decision: ${String((decision as {decision?: unknown}).decision)}`);
}

function resolveAskConfig(decision: HILAskDecision, baseConfig: HILInterruptConfig | null): HILInterruptConfig {
  const base = baseConfig ?? {};
  const next = decision.config ?? {};
  const mergedMetadata = {
    ...(base.metadata ?? {}),
    ...(next.metadata ?? {}),
    ...(decision.metadata ?? {}),
  };

  return {
    ...base,
    ...next,
    allowedDecisions: next.allowedDecisions ?? base.allowedDecisions ?? DEFAULT_ALLOWED_DECISIONS,
    ...(Object.keys(mergedMetadata).length > 0 ? {metadata: mergedMetadata} : {}),
  };
}

function defaultDecisionResolver(input: HILDecisionContext): HILDecision {
  if (!input.interruptConfig) {
    return {decision: 'allow'};
  }

  return {
    decision: 'ask',
    config: input.interruptConfig,
  };
}

async function defaultPauseRequestFactory(
  context: ToolCallContext,
  config: HILInterruptConfig,
  descriptionPrefix: string
): Promise<PauseRequest> {
  const execution = readExecutionMetadata(context);
  const toolCallId = resolveToolCallId(context.toolCall, context.toolIndex);
  const toolName = context.toolCall.name;
  const toolArgs = normalizeArgs(context.toolCall.args);

  const description = await resolveDescription(context, config.description, descriptionPrefix, toolName, toolArgs);

  return {
    id: `${execution.runId}:${execution.turn}:${toolCallId}`,
    description,
    action: {
      toolCallId,
      toolName,
      toolArgs,
    },
    review: {
      actionName: toolName,
      allowedDecisions: normalizeAllowedDecisions(config.allowedDecisions),
    },
    runtime: {
      runId: execution.runId,
      turn: execution.turn,
      requestId: execution.requestId,
      toolIndex: context.toolIndex,
    },
    ...(config.channel ? {channel: config.channel} : {}),
    ...(config.ui ? {ui: config.ui} : {}),
    ...(config.metadata ? {metadata: config.metadata} : {}),
  };
}

function noopPauseNotifier(): void {
  return;
}

function createDefaultResumeHandler(createDenyMessage: HILDenyMessageFactory): HILResumeHandler {
  return async (_request, resumePayload, context, handler) => {
    const payload = parseHILResumeActionPayload(resumePayload);
    if (payload.decision === 'reject') {
      return createDenyMessage(
        {
          decision: 'deny',
          reason: payload.comment,
          ...(payload.metadata ? {metadata: payload.metadata} : {}),
        },
        context
      );
    }

    const nextContext = applyHILResumeToolEdits(context, payload);
    return handler(nextContext);
  };
}

function defaultPauseMessageFactory(request: PauseRequest): ToolMessage {
  const payload: HILToolMessagePayload = {
    type: 'hil_pause',
    request,
  };

  return new ToolMessage({
    content: JSON.stringify(payload),
    response_metadata: buildObservabilityMetadata('hil_pause', request.metadata, request.channel, request.ui),
    tool_call_id: request.action.toolCallId,
    name: request.action.toolName,
  });
}

function defaultDenyMessageFactory(decision: HILDenyDecision, context: ToolCallContext): ToolMessage {
  const toolCallId = resolveToolCallId(context.toolCall, context.toolIndex);
  const reason = decision.reason?.trim() || 'Tool execution denied by external policy';
  const payload: HILToolMessagePayload = {
    type: 'hil_deny',
    reason,
    metadata: decision.metadata ?? {},
    action: {
      toolCallId,
      toolName: context.toolCall.name,
    },
  };

  return new ToolMessage({
    content: JSON.stringify(payload),
    response_metadata: buildObservabilityMetadata('hil_deny', decision.metadata),
    tool_call_id: toolCallId,
    name: context.toolCall.name,
    status: 'error',
  });
}

function defaultResumeResolver(request: PauseRequest, context: ToolCallContext): ResumePayload | undefined {
  const hil = readHILContext(context.runtime.context);
  const resumes = readRecord(hil.resumes);

  // 1) exact map by pause id
  if (Object.prototype.hasOwnProperty.call(resumes, request.id)) {
    return resumes[request.id];
  }

  // 2) map by tool call id
  if (Object.prototype.hasOwnProperty.call(resumes, request.action.toolCallId)) {
    return resumes[request.action.toolCallId];
  }

  // 3) single resume payload
  if (Object.prototype.hasOwnProperty.call(hil, 'resume')) {
    return hil.resume;
  }

  return undefined;
}

/**
 * Normalize the external resume payload into a predictable action shape.
 * This keeps UI-specific transport formats out of middleware handlers.
 */
export function parseHILResumeActionPayload(payload: ResumePayload): HILResumeActionPayload {
  const root = readRecord(payload);
  return {
    ...(isReviewDecision(root.decision) ? {decision: root.decision} : {}),
    ...(readOptionalString(root.action) ? {action: readOptionalString(root.action)} : {}),
    ...(readOptionalString(root.scope) ? {scope: readOptionalString(root.scope)} : {}),
    ...(readOptionalString(root.comment) ? {comment: readOptionalString(root.comment)} : {}),
    ...(readOptionalString(root.editedToolName) ? {editedToolName: readOptionalString(root.editedToolName)} : {}),
    ...(isRecord(root.editedToolArgs) ? {editedToolArgs: root.editedToolArgs} : {}),
    ...(isRecord(root.metadata) ? {metadata: root.metadata} : {}),
  };
}

/**
 * Apply resume-driven tool edits in a generic way.
 * Review or approval flows can use this to support "edit and continue"
 * without encoding domain semantics in the HIL core.
 */
export function applyHILResumeToolEdits(
  context: ToolCallContext,
  payload: HILResumeActionPayload
): ToolCallContext {
  if (!payload.editedToolName && !payload.editedToolArgs) {
    return context;
  }

  return {
    ...context,
    toolCall: {
      ...context.toolCall,
      ...(payload.editedToolName ? {name: payload.editedToolName} : {}),
      args: payload.editedToolArgs
        ? {
            ...normalizeArgs(context.toolCall.args),
            ...payload.editedToolArgs,
          }
        : context.toolCall.args,
    },
  };
}

/**
 * Parse the structured HIL tool payload emitted by the default pause/deny
 * factories. Consumers such as terminals or approval services can reuse this
 * helper instead of duplicating ad-hoc JSON parsing.
 */
export function parseHILToolMessagePayload(content: unknown): HILToolMessagePayload | undefined {
  const raw = typeof content === 'string' ? content : String(content ?? '');
  if (!raw.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      return undefined;
    }

    if (parsed.type === 'hil_pause') {
      return isPauseRequest(parsed.request) ? {type: 'hil_pause', request: parsed.request} : undefined;
    }

    if (parsed.type === 'hil_deny') {
      const action = readRecord(parsed.action);
      if (
        typeof parsed.reason !== 'string'
        || !isRecord(parsed.metadata)
        || typeof action.toolCallId !== 'string'
        || typeof action.toolName !== 'string'
      ) {
        return undefined;
      }

      return {
        type: 'hil_deny',
        reason: parsed.reason,
        metadata: parsed.metadata,
        action: {
          toolCallId: action.toolCallId,
          toolName: action.toolName,
        },
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

async function resolveDescription(
  context: ToolCallContext,
  descriptionValue: string | HILDescriptionFactory | undefined,
  descriptionPrefix: string,
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<string> {
  if (typeof descriptionValue === 'function') {
    return descriptionValue(context.toolCall, context.state, context.runtime);
  }
  if (typeof descriptionValue === 'string') {
    return descriptionValue;
  }
  return `${descriptionPrefix}\n\nTool: ${toolName}\nArgs: ${JSON.stringify(toolArgs, null, 2)}`;
}

function resolveToolCallId(toolCall: ToolCall, toolIndex: number): string {
  const existingId = typeof toolCall.id === 'string' ? toolCall.id.trim() : '';
  if (existingId) {
    return existingId;
  }
  return `hil_${toolIndex}`;
}

function normalizeArgs(args: unknown): Record<string, unknown> {
  return readRecord(args);
}

function buildObservabilityMetadata(
  toolResultType: 'hil_pause' | 'hil_deny',
  metadata?: Record<string, unknown>,
  channel?: string,
  ui?: PauseUIConfig,
): Record<string, unknown> {
  const skill = extractSkillFromMetadata(metadata);
  const actorType = extractActorType(metadata);
  const delegatedChildSessionId = extractDelegatedChildSessionId(metadata);
  const actionIds = extractActionIds(ui);
  return {
    toolResultType,
    interactionDecision: toolResultType === 'hil_pause' ? 'ask' : 'deny',
    ...(channel ? {interactionChannel: channel} : {}),
    ...(skill ? {interactionSkill: skill} : {}),
    ...(actorType ? {interactionActorType: actorType} : {}),
    ...(delegatedChildSessionId ? {delegatedChildSessionId} : {}),
    ...(actionIds.length > 0 ? {interactionActionIds: actionIds} : {}),
  };
}

function extractSkillFromMetadata(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.skill === 'string' ? metadata.skill : undefined;
}

function extractActorType(metadata: Record<string, unknown> | undefined): string | undefined {
  const codara = metadata?.codara;
  if (!codara || typeof codara !== 'object' || Array.isArray(codara)) {
    return undefined;
  }

  const actor = (codara as Record<string, unknown>).actor;
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
    return undefined;
  }

  return typeof (actor as Record<string, unknown>).agentType === 'string'
    ? String((actor as Record<string, unknown>).agentType)
    : undefined;
}

function extractDelegatedChildSessionId(metadata: Record<string, unknown> | undefined): string | undefined {
  const codara = metadata?.codara;
  if (!codara || typeof codara !== 'object' || Array.isArray(codara)) {
    return undefined;
  }

  const delegated = (codara as Record<string, unknown>).delegatedSubagent;
  if (!delegated || typeof delegated !== 'object' || Array.isArray(delegated)) {
    return undefined;
  }

  return typeof (delegated as Record<string, unknown>).childSessionId === 'string'
    ? String((delegated as Record<string, unknown>).childSessionId)
    : undefined;
}

function extractActionIds(ui: PauseUIConfig | undefined): string[] {
  if (!Array.isArray(ui?.actions)) {
    return [];
  }

  return ui.actions
    .map((action) => action.id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
}

function normalizeAllowedDecisions(allowedDecisions: PauseReviewDecision[] | undefined): PauseReviewDecision[] {
  if (!allowedDecisions || allowedDecisions.length === 0) {
    return [...DEFAULT_ALLOWED_DECISIONS];
  }

  const unique: PauseReviewDecision[] = [];
  const seen = new Set<PauseReviewDecision>();
  for (const decision of allowedDecisions) {
    if (seen.has(decision)) {
      continue;
    }
    seen.add(decision);
    unique.push(decision);
  }

  return unique;
}

function readHILContext(runtimeContext: unknown): Record<string, unknown> {
  const root = readRecord(runtimeContext);
  const nested = readRecord(root.hil);
  return Object.keys(nested).length > 0 ? nested : root;
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isPauseRequest(value: unknown): value is PauseRequest {
  if (!isRecord(value)) {
    return false;
  }
  const {id, description, action, review, runtime} = value;
  return (
    typeof id === 'string'
    && typeof description === 'string'
    && isRecord(action)
    && typeof (action as Record<string, unknown>).toolCallId === 'string'
    && typeof (action as Record<string, unknown>).toolName === 'string'
    && isRecord(review)
    && typeof (review as Record<string, unknown>).actionName === 'string'
    && isRecord(runtime)
    && typeof (runtime as Record<string, unknown>).runId === 'string'
  );
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isReviewDecision(value: unknown): value is PauseReviewDecision {
  return value === 'approve' || value === 'edit' || value === 'reject';
}

function isInterruptOn(value: unknown): value is HILInterruptOn {
  return isRecord(value);
}

function isInterruptConfig(value: unknown): value is HILInterruptConfig {
  if (!isRecord(value)) {
    return false;
  }

  if (value.description !== undefined && typeof value.description !== 'string' && typeof value.description !== 'function') {
    return false;
  }
  if (value.channel !== undefined && typeof value.channel !== 'string') {
    return false;
  }
  if (value.ui !== undefined && !isRecord(value.ui)) {
    return false;
  }
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    return false;
  }
  if (value.allowedDecisions !== undefined) {
    if (!Array.isArray(value.allowedDecisions)) {
      return false;
    }
    if (value.allowedDecisions.some((decision) => !isReviewDecision(decision))) {
      return false;
    }
  }

  return true;
}
