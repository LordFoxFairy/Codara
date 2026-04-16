import {ToolMessage} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import type {ReviewUIActionOption} from '@shared/agent-types';
import {createReviewMiddleware, parseReviewResumeActionPayload, type ReviewMiddlewareOptions} from '@core/middleware/review';
import {createMiddleware} from '@core/pipeline-types';

const ASK_USER_TOOL_NAME = 'AskUserQuestion';
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
const MAX_ASK_USER_QUESTIONS = 4;
const MAX_ASK_USER_TAB_LABEL_LENGTH = 12;

const AskUserOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
});

const AskUserQuestionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  question: z.string().min(1),
  input: z.enum(['select', 'multiselect', 'text']).optional(),
  options: z.array(AskUserOptionSchema).optional(),
  placeholder: z.string().min(1).optional(),
});

export const AskUserSchema = z.object({
  summary: z.string().min(1).optional(),
  questions: z.array(AskUserQuestionSchema).min(1),
  channel: z.string().min(1).optional(),
  tab: z.string().min(1).optional(),
  submitLabel: z.string().min(1).optional(),
});

export type AskUserInput = z.infer<typeof AskUserSchema>;
export type AskUserQuestion = z.infer<typeof AskUserQuestionSchema>;
export type AskUserOption = z.infer<typeof AskUserOptionSchema>;
export type AskUserAnswerValue = string | string[];

export interface AskUserResult {
  action: string;
  answers: Record<string, AskUserAnswerValue>;
  comment?: string;
}

export interface AskUserQuestionMiddlewareOptions extends Omit<ReviewMiddlewareOptions, 'interruptOn'> {
  askUserToolName?: string;
}

export function createAskUserTool() {
  return tool(
    async () => 'AskUserQuestion requires interaction middleware to pause and collect user input.',
    {
      name: ASK_USER_TOOL_NAME,
      description: 'Request structured user input before the agent continues. Use this when key requirements, scope, priorities, or constraints are missing and proceeding would force guesses, weak plans, or wasted work. Prefer AskUserQuestion before reading files, planning architecture, or running exploratory steps when a small number of concrete user answers would materially change the next action. Keep AskUserQuestion concise: ask at most 4 questions, keep each tab/header label short (12 characters or fewer), and only ask the highest-leverage clarifications. Gather the needed clarification in one questionnaire whenever possible instead of chaining multiple AskUserQuestion calls back-to-back. Set each question input explicitly when possible: prefer select for one clear choice, multiselect for multiple choices, and text for pure free-form answers. The CLI already allows users to type a custom answer while reviewing any question, so use explicit options unless the question is truly free-form. If clarification is needed, call AskUserQuestion directly instead of only saying that you will ask questions. Once the user answers, continue the original task immediately instead of summarizing the questionnaire back to them or opening another questionnaire right away.',
      schema: AskUserSchema,
    },
  );
}

export function createAskUserQuestionMiddleware(options: AskUserQuestionMiddlewareOptions = {}) {
  const askUserToolName = options.askUserToolName?.trim() || ASK_USER_TOOL_NAME;
  const askUserTool = createAskUserTool();

  const reviewMiddleware = createReviewMiddleware({
    ...options,
    name: options.name?.trim() || 'AskUserQuestionMiddleware',
    resolveDecision: async (input) => {
      if (input.context.toolCall.name !== askUserToolName) {
        return options.resolveDecision?.(input);
      }

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

      const ask = parseInput(input.context.toolCall.args);
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
      if (context.toolCall.name !== askUserToolName) {
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

export function parseAskUserResult(content: unknown): AskUserResult | undefined {
  if (typeof content !== 'string' || !content.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;

    const action = typeof parsed.action === 'string' ? parsed.action.trim() : '';
    const rawAnswers = parsed.answers;
    if (!action || !rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) return undefined;

    const answers = normalizeAnswers(rawAnswers);
    const comment = typeof parsed.comment === 'string' && parsed.comment.trim() ? parsed.comment.trim() : undefined;
    return {action, answers, ...(comment ? {comment} : {})};
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseInput(value: unknown): AskUserInput {
  const parsed = AskUserSchema.safeParse(value);
  if (parsed.success) {
    return normalizeInput(parsed.data);
  }

  // Fallback: if zod fails (e.g. LLM sent slightly off-spec args), do minimal extraction
  const record = value as Record<string, unknown> | undefined;
  if (!record || typeof record !== 'object' || !Array.isArray(record.questions) || record.questions.length === 0) {
    throw new Error('AskUserQuestion requires at least one valid question.');
  }

  // Coerce non-string fields that the LLM may send as objects (e.g. {text: "..."})
  return normalizeInput({
    ...record,
    summary: coerceToString(record.summary),
    channel: coerceToString(record.channel),
    tab: coerceToString(record.tab),
    submitLabel: coerceToString(record.submitLabel),
    questions: record.questions,
  } as unknown as AskUserInput);
}

function normalizeInput(input: AskUserInput): AskUserInput {
  return {
    ...input,
    questions: input.questions
      .slice(0, MAX_ASK_USER_QUESTIONS)
      .map((q) => ({...q, label: q.label.trim().slice(0, MAX_ASK_USER_TAB_LABEL_LENGTH)})),
  };
}

function extractResumeResult(payload: ReturnType<typeof parseReviewResumeActionPayload>): AskUserResult {
  const formAnswers = extractFormAnswers(payload.metadata);
  return {
    action: payload.action?.trim() || 'submit',
    answers: formAnswers,
    ...(payload.comment?.trim() ? {comment: payload.comment.trim()} : {}),
  };
}

function extractFormAnswers(metadata: unknown): Record<string, AskUserAnswerValue> {
  const form = (metadata as Record<string, unknown> | undefined)?.form;
  const answers = (form as Record<string, unknown> | undefined)?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return {};
  return normalizeAnswers(answers as Record<string, unknown>);
}

function normalizeAnswers(raw: Record<string, unknown>): Record<string, AskUserAnswerValue> {
  const result: Record<string, AskUserAnswerValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key.trim()) continue;
    if (typeof value === 'string') {
      result[key] = value;
    } else if (Array.isArray(value)) {
      const filtered = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
      if (filtered.length > 0) result[key] = filtered;
    }
  }
  return result;
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

function coerceToString(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ['text', 'label', 'value', 'summary', 'description']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  }
  return undefined;
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

export {ASK_USER_TOOL_NAME};
