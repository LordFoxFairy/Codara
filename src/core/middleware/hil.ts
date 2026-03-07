import {ToolMessage, type ToolCall} from '@langchain/core/messages';
import {z} from 'zod';
import {createMiddleware, type ToolCallContext} from '@core/middleware/types';

export interface HILActionDescriptor {
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
}

export interface HILPauseRequest {
  id: string;
  description: string;
  action: HILActionDescriptor;
  review: HILReviewRequest;
  runtime: {
    runId: string;
    turn: number;
    requestId: string;
    toolIndex: number;
  };
  channel?: string;
  ui?: HILUIConfig;
  metadata?: Record<string, unknown>;
}

/**
 * Opaque interaction action descriptor carried by HIL.
 * Action ids and their business meaning are defined by the caller
 * (for example a skill template or approval service), not by HIL itself.
 */
export interface HILUIActionOption {
  id: string;
  label: string;
  kind?: 'primary' | 'secondary' | 'danger';
  description?: string;
  requiresConfirmation?: boolean;
  requiresToolEdit?: boolean;
}

export interface HILUIConfig {
  tab?: string;
  modal?: string;
  actions?: HILUIActionOption[];
  [key: string]: unknown;
}

export type HILReviewDecision = 'approve' | 'edit' | 'reject';

/**
 * LangChain/LangGraph-style review contract carried alongside the UI payload.
 * `allowedDecisions` is protocol-level guidance for approval handlers, while
 * `ui.actions` remains an optional presentation concern for terminals/UIs.
 */
export interface HILReviewRequest {
  actionName: string;
  allowedDecisions: HILReviewDecision[];
}

export type HILDescriptionFactory = (
  toolCall: ToolCall,
  state: ToolCallContext['state'],
  runtime: ToolCallContext['runtime']
) => string | Promise<string>;

export interface HILInterruptConfig {
  description?: string | HILDescriptionFactory;
  channel?: string;
  ui?: HILUIConfig;
  metadata?: Record<string, unknown>;
  allowedDecisions?: HILReviewDecision[];
}

export type HILInterruptOn = Record<string, boolean | HILInterruptConfig>;

export interface HILContextConfig {
  interruptOn?: HILInterruptOn;
  descriptionPrefix?: string;
}

export type HILResumePayload = unknown;

/**
 * Generic resume payload shape used by higher-level interaction layers.
 * `scope` is intentionally opaque to HIL so approval persistence can stay
 * in project policy or other external stores.
 */
export interface HILResumeActionPayload {
  decision?: HILReviewDecision;
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
) => Promise<HILPauseRequest> | HILPauseRequest;

export type HILPauseNotifier = (request: HILPauseRequest, context: ToolCallContext) => Promise<void> | void;

export type HILResumeResolver = (
  request: HILPauseRequest,
  context: ToolCallContext
) => Promise<HILResumePayload | undefined> | HILResumePayload | undefined;

export type HILResumeHandler = (
  request: HILPauseRequest,
  resumePayload: HILResumePayload,
  context: ToolCallContext,
  handler: (request?: ToolCallContext) => Promise<ToolMessage>
) => Promise<ToolMessage>;

export type HILPauseMessageFactory = (request: HILPauseRequest, context: ToolCallContext) => ToolMessage;

export type HILDenyMessageFactory = (decision: HILDenyDecision, context: ToolCallContext) => ToolMessage;

interface HILObservabilityMetadata extends Record<string, unknown> {
  toolResultType: 'hil_pause' | 'hil_deny';
  interactionDecision: 'ask' | 'deny';
  interactionChannel?: string;
  interactionSkill?: string;
  interactionActionIds?: string[];
}

export type HILToolMessagePayload =
  | {
      type: 'hil_pause';
      request: HILPauseRequest;
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
const DEFAULT_ALLOWED_DECISIONS: HILReviewDecision[] = ['approve', 'edit', 'reject'];

const contextSchema = z.looseObject({
  interruptOn: z.record(z.string(), z.any()).optional(),
  descriptionPrefix: z.string().optional(),
  hil: z.record(z.string(), z.any()).optional(),
});

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
    contextSchema,
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

/** Alias for naming parity with LangChain. */
export const humanInTheLoopMiddleware = createHILMiddleware;

function resolveEffectiveConfig(options: HILMiddlewareOptions, runtimeContext: unknown): HILEffectiveConfig {
  const runtimeOverrides = extractRuntimeHILOverrides(runtimeContext);
  return {
    interruptOn: runtimeOverrides.interruptOn ?? options.interruptOn,
    descriptionPrefix: runtimeOverrides.descriptionPrefix ?? options.descriptionPrefix ?? DEFAULT_DESCRIPTION_PREFIX,
  };
}

function extractRuntimeHILOverrides(runtimeContext: unknown): HILContextConfig {
  if (!isRecord(runtimeContext)) {
    return {};
  }

  // Support both `context.hil.{...}` and top-level fallback.
  const preferred = isRecord(runtimeContext.hil) ? runtimeContext.hil : runtimeContext;
  const parsed = contextSchema.safeParse(preferred);
  if (!parsed.success) {
    return {};
  }

  const data = parsed.data as Record<string, unknown>;
  return {
    interruptOn: isRecord(data.interruptOn) ? (data.interruptOn as HILInterruptOn) : undefined,
    descriptionPrefix: typeof data.descriptionPrefix === 'string' ? data.descriptionPrefix : undefined,
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

  if (!isRecord(rawValue)) {
    throw new Error(`Invalid interruptOn config for tool "${toolName}"`);
  }

  const raw = rawValue as Record<string, unknown>;

  const description = raw.description;
  if (description !== undefined && typeof description !== 'string' && typeof description !== 'function') {
    throw new Error(`interruptOn.${toolName}.description must be a string or function`);
  }

  const channel = raw.channel;
  if (channel !== undefined && typeof channel !== 'string') {
    throw new Error(`interruptOn.${toolName}.channel must be a string`);
  }

  const ui = raw.ui;
  if (ui !== undefined && !isHILUIConfig(ui)) {
    throw new Error(`interruptOn.${toolName}.ui must be an object`);
  }

  const metadata = raw.metadata;
  if (metadata !== undefined && !isRecord(metadata)) {
    throw new Error(`interruptOn.${toolName}.metadata must be an object`);
  }

  const allowedDecisions = raw.allowedDecisions;
  if (allowedDecisions !== undefined && !isHILReviewDecisions(allowedDecisions)) {
    throw new Error(`interruptOn.${toolName}.allowedDecisions must be an array of approve/edit/reject`);
  }

  return {
    ...(description !== undefined ? {description: description as string | HILDescriptionFactory} : {}),
    ...(channel !== undefined ? {channel} : {}),
    ...(ui !== undefined ? {ui} : {}),
    ...(metadata !== undefined ? {metadata: metadata as Record<string, unknown>} : {}),
    ...(allowedDecisions !== undefined ? {allowedDecisions: [...allowedDecisions]} : {}),
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
): Promise<HILPauseRequest> {
  const toolCallId = resolveToolCallId(context.toolCall, context.toolIndex);
  const toolName = context.toolCall.name;
  const toolArgs = normalizeArgs(context.toolCall.args);

  const description = await resolveDescription(context, config.description, descriptionPrefix, toolName, toolArgs);

  return {
    id: `${context.runId}:${context.turn}:${toolCallId}`,
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
      runId: context.runId,
      turn: context.turn,
      requestId: context.requestId,
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

function defaultPauseMessageFactory(request: HILPauseRequest): ToolMessage {
  const payload: HILToolMessagePayload = {
    type: 'hil_pause',
    request,
  };

  return new ToolMessage({
    content: JSON.stringify(payload),
    response_metadata: buildPauseObservabilityMetadata(request),
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
    response_metadata: buildDenyObservabilityMetadata(decision),
    tool_call_id: toolCallId,
    name: context.toolCall.name,
    status: 'error',
  });
}

function defaultResumeResolver(request: HILPauseRequest, context: ToolCallContext): HILResumePayload | undefined {
  const root = context.runtime.context;
  if (!isRecord(root)) {
    return undefined;
  }

  const hil = isRecord(root.hil) ? root.hil : root;

  // 1) exact map by pause id
  const resumes = hil.resumes;
  if (hasOwnRecordKey(resumes, request.id)) {
    return resumes[request.id];
  }

  // 2) map by tool call id
  if (hasOwnRecordKey(resumes, request.action.toolCallId)) {
    return resumes[request.action.toolCallId];
  }

  // 3) single resume payload
  if (hasOwnRecordKey(hil, 'resume')) {
    return hil.resume;
  }

  return undefined;
}

/**
 * Normalize the external resume payload into a predictable action shape.
 * This keeps UI-specific transport formats out of middleware handlers.
 */
export function parseHILResumeActionPayload(payload: HILResumePayload): HILResumeActionPayload {
  if (!isRecord(payload)) {
    return {};
  }

  const editedToolArgs = isRecord(payload.editedToolArgs) ? payload.editedToolArgs : undefined;
  const metadata = isRecord(payload.metadata) ? payload.metadata : undefined;

  return {
    decision: isHILReviewDecision(payload.decision) ? payload.decision : undefined,
    action: parseOptionalNonEmptyString(payload.action),
    scope: parseOptionalNonEmptyString(payload.scope),
    comment: parseOptionalNonEmptyString(payload.comment),
    editedToolName: parseOptionalNonEmptyString(payload.editedToolName),
    ...(editedToolArgs ? {editedToolArgs} : {}),
    ...(metadata ? {metadata} : {}),
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
    const parsed = JSON.parse(raw) as unknown;
    if (!isHILToolMessagePayload(parsed)) {
      return undefined;
    }

    return parsed;
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
  return isRecord(args) ? args : {};
}

function buildPauseObservabilityMetadata(request: HILPauseRequest): HILObservabilityMetadata {
  return {
    toolResultType: 'hil_pause',
    interactionDecision: 'ask',
    ...(typeof request.channel === 'string' ? {interactionChannel: request.channel} : {}),
    ...(extractSkillFromMetadata(request.metadata) ? {interactionSkill: extractSkillFromMetadata(request.metadata)} : {}),
    ...(extractActionIds(request.ui).length > 0 ? {interactionActionIds: extractActionIds(request.ui)} : {}),
  };
}

function buildDenyObservabilityMetadata(decision: HILDenyDecision): HILObservabilityMetadata {
  return {
    toolResultType: 'hil_deny',
    interactionDecision: 'deny',
    ...(extractSkillFromMetadata(decision.metadata) ? {interactionSkill: extractSkillFromMetadata(decision.metadata)} : {}),
  };
}

function extractSkillFromMetadata(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.skill === 'string' ? metadata.skill : undefined;
}

function extractActionIds(ui: HILUIConfig | undefined): string[] {
  if (!Array.isArray(ui?.actions)) {
    return [];
  }

  return ui.actions
    .map((action) => action.id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
}

function normalizeAllowedDecisions(allowedDecisions: HILReviewDecision[] | undefined): HILReviewDecision[] {
  if (!allowedDecisions || allowedDecisions.length === 0) {
    return [...DEFAULT_ALLOWED_DECISIONS];
  }

  const unique: HILReviewDecision[] = [];
  const seen = new Set<HILReviewDecision>();
  for (const decision of allowedDecisions) {
    if (seen.has(decision)) {
      continue;
    }
    seen.add(decision);
    unique.push(decision);
  }

  return unique;
}

function parseOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasOwnRecordKey(record: unknown, key: string): record is Record<string, unknown> {
  return isRecord(record) && Object.prototype.hasOwnProperty.call(record, key);
}

function isHILReviewDecision(value: unknown): value is HILReviewDecision {
  return value === 'approve' || value === 'edit' || value === 'reject';
}

function isHILReviewDecisions(value: unknown): value is HILReviewDecision[] {
  return Array.isArray(value) && value.every((item) => isHILReviewDecision(item));
}

function isHILPauseMessagePayload(value: unknown): value is Extract<HILToolMessagePayload, {type: 'hil_pause'}> {
  return isRecord(value)
    && value.type === 'hil_pause'
    && isRecord(value.request)
    && typeof value.request.id === 'string';
}

function isHILDenyMessagePayload(value: unknown): value is Extract<HILToolMessagePayload, {type: 'hil_deny'}> {
  return isRecord(value)
    && value.type === 'hil_deny'
    && typeof value.reason === 'string'
    && isRecord(value.metadata)
    && isRecord(value.action)
    && typeof value.action.toolCallId === 'string'
    && typeof value.action.toolName === 'string';
}

function isHILToolMessagePayload(value: unknown): value is HILToolMessagePayload {
  return isHILPauseMessagePayload(value) || isHILDenyMessagePayload(value);
}

function isHILUIActionOption(value: unknown): value is HILUIActionOption {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string' || typeof value.label !== 'string') {
    return false;
  }

  if (value.kind !== undefined && value.kind !== 'primary' && value.kind !== 'secondary' && value.kind !== 'danger') {
    return false;
  }

  if (value.description !== undefined && typeof value.description !== 'string') {
    return false;
  }

  if (value.requiresConfirmation !== undefined && typeof value.requiresConfirmation !== 'boolean') {
    return false;
  }

  return !(value.requiresToolEdit !== undefined && typeof value.requiresToolEdit !== 'boolean');


}

function isHILUIConfig(value: unknown): value is HILUIConfig {
  if (!isRecord(value)) {
    return false;
  }

  if (value.tab !== undefined && typeof value.tab !== 'string') {
    return false;
  }

  if (value.modal !== undefined && typeof value.modal !== 'string') {
    return false;
  }

  if (value.actions !== undefined) {
    if (!Array.isArray(value.actions)) {
      return false;
    }

    for (const action of value.actions) {
      if (!isHILUIActionOption(action)) {
        return false;
      }
    }
  }

  return true;
}
