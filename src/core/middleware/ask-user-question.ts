/**
 * AskUserQuestion middleware -- thin pause/resume interception layer.
 *
 * The real tool lives in `@tools/ask-user`. This middleware only:
 * 1. Registers the AskUser tool with the pipeline
 * 2. Detects AskUser tool calls and triggers review pause
 * 3. Handles resume by extracting form answers from the review payload
 *
 * All schema, types, parsing, and the tool class itself are in `@tools/ask-user`.
 */

import {ToolMessage} from '@langchain/core/messages';
import type {ReviewUIActionOption} from '@shared/agent-types';
import {createReviewMiddleware, parseReviewResumeActionPayload, type ReviewMiddlewareOptions} from '@core/middleware/review';
import {createMiddleware} from '@core/pipeline-types';
import {
  ASK_USER_TOOL_NAME,
  createAskUserTool,
  parseAskUserInput,
  normalizeAnswers,
  type AskUserResult,
  type AskUserAnswerValue,
} from '@tools/ask-user';

// Re-export everything from the tool module for backward compatibility
export {
  ASK_USER_TOOL_NAME,
  AskUserSchema,
  createAskUserTool,
  parseAskUserResult,
  parseAskUserInput,
  type AskUserInput,
  type AskUserQuestion,
  type AskUserOption,
  type AskUserAnswerValue,
  type AskUserResult,
} from '@tools/ask-user';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CHANNEL = 'interaction-center';
const DEFAULT_TAB_LABEL = 'User Input';
const DEFAULT_SUBMIT_LABEL = 'Submit';
const DEFAULT_CANCEL_LABEL = 'Cancel';
const ASK_USER_CONTINUATION_GUIDANCE =
  'Use these answers as settled user input and continue the original task immediately. ' +
  'Do not summarize the questionnaire, restate the collected answers, or ask the same clarifying questions again unless the user explicitly asked for a recap.';
const ASK_USER_REPEAT_BLOCK_GUIDANCE =
  'AskUserQuestion was just answered in this flow. Do not open another questionnaire immediately. ' +
  'Use the collected answers below and continue the original task unless the user explicitly asked for another form.';

// ---------------------------------------------------------------------------
// Middleware options
// ---------------------------------------------------------------------------

export interface AskUserQuestionMiddlewareOptions extends Omit<ReviewMiddlewareOptions, 'interruptOn'> {
  askUserToolName?: string;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export function createAskUserQuestionMiddleware(options: AskUserQuestionMiddlewareOptions = {}) {
  const toolName = options.askUserToolName?.trim() || ASK_USER_TOOL_NAME;
  const askUserTool = createAskUserTool();

  const reviewMiddleware = createReviewMiddleware({
    ...options,
    name: options.name?.trim() || 'AskUserQuestionMiddleware',

    resolveDecision: async (input) => {
      if (input.context.toolCall.name !== toolName) {
        return options.resolveDecision?.(input);
      }

      // Guard: block repeated AskUser calls in the same flow
      const repeated = readContinuationState(input.context.runtime.context);
      if (repeated) {
        return {
          decision: 'deny',
          message: new ToolMessage({
            content: buildRepeatedMessage(repeated),
            tool_call_id: input.context.execution.toolCallId ?? input.context.toolCall.id ?? ASK_USER_TOOL_NAME,
            artifact: {type: 'ask_user_internal', visibility: 'hidden', reason: 'continuation_guard'},
          }),
        };
      }

      // Parse tool args into a normalized AskUserInput
      const ask = parseAskUserInput(input.context.toolCall.args);

      return {
        decision: 'ask',
        config: {
          description: ask.summary?.trim() || 'Additional user input is required before the agent can continue.',
          channel: ask.channel?.trim() || DEFAULT_CHANNEL,
          ui: {
            tab: ask.tab?.trim() || DEFAULT_TAB_LABEL,
            actions: [
              {id: 'submit', label: ask.submitLabel?.trim() || DEFAULT_SUBMIT_LABEL, kind: 'primary' as const},
              {id: 'cancel', label: DEFAULT_CANCEL_LABEL, kind: 'secondary' as const},
            ] satisfies ReviewUIActionOption[],
            form: {
              ...(ask.summary?.trim() ? {summary: ask.summary.trim()} : {}),
              tabs: ask.questions.map((q) => ({
                id: q.id,
                label: q.label,
                question: q.question,
                ...(q.input ? {input: q.input} : {}),
                ...(q.options?.length ? {options: q.options} : {}),
                ...(q.placeholder?.trim() ? {placeholder: q.placeholder.trim()} : {}),
              })),
            },
          },
          metadata: {codara: {interaction: {kind: 'ask-user'}}},
        },
      };
    },

    handleResume: async (request, resumePayload, context, handler) => {
      if (context.toolCall.name !== toolName) {
        return options.handleResume
          ? options.handleResume(request, resumePayload, context, handler)
          : handler(context);
      }

      const payload = parseReviewResumeActionPayload(resumePayload);
      const result = extractResumeResult(payload);
      writeContinuationState(context.runtime.runtimeContext, result);

      return new ToolMessage({
        content: JSON.stringify({...result, guidance: ASK_USER_CONTINUATION_GUIDANCE}),
        tool_call_id: request.action.toolCallId,
      });
    },
  });

  return createMiddleware({
    name: reviewMiddleware.name,
    tools: [askUserTool],
    wrapToolCall: reviewMiddleware.wrapToolCall,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers (continuation state + resume extraction)
// ---------------------------------------------------------------------------

function extractResumeResult(payload: ReturnType<typeof parseReviewResumeActionPayload>): AskUserResult {
  const form = (payload.metadata as Record<string, unknown> | undefined)?.form;
  const answers = (form as Record<string, unknown> | undefined)?.answers;
  const formAnswers = answers && typeof answers === 'object' && !Array.isArray(answers)
    ? normalizeAnswers(answers as Record<string, unknown>)
    : {};

  return {
    action: payload.action?.trim() || 'submit',
    answers: formAnswers,
    ...(payload.comment?.trim() ? {comment: payload.comment.trim()} : {}),
  };
}

function readContinuationState(runtimeContext: unknown): AskUserResult | undefined {
  const root = runtimeContext as Record<string, unknown> | undefined;
  const continuation = (root?.codaraInteraction as Record<string, unknown> | undefined)?.askUserContinuation as Record<string, unknown> | undefined;
  if (!continuation || continuation.action !== 'submit') return undefined;

  const rawAnswers = continuation.answers;
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) return undefined;

  const answers = normalizeAnswers(rawAnswers as Record<string, unknown>);
  if (Object.keys(answers).length === 0) return undefined;

  const comment = typeof continuation.comment === 'string' && continuation.comment.trim() ? continuation.comment.trim() : undefined;
  return {action: 'submit', answers, ...(comment ? {comment} : {})};
}

function writeContinuationState(runtimeContext: Record<string, unknown> | undefined, result: AskUserResult): void {
  if (!runtimeContext) return;
  const existing = runtimeContext.codaraInteraction;
  const interaction = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? {...(existing as Record<string, unknown>)}
    : {};
  interaction.askUserContinuation = {
    action: result.action,
    answers: result.answers,
    ...(result.comment ? {comment: result.comment} : {}),
  };
  runtimeContext.codaraInteraction = interaction;
}

function buildRepeatedMessage(result: AskUserResult): string {
  const lines = [
    ASK_USER_REPEAT_BLOCK_GUIDANCE,
    ASK_USER_CONTINUATION_GUIDANCE,
    `Collected answers: ${JSON.stringify(result.answers)}`,
  ];
  if (result.comment?.trim()) lines.push(`User comment: ${result.comment.trim()}`);
  return lines.join('\n');
}
