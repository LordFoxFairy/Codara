import {ToolMessage} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import type {ReviewUIActionOption} from '@shared/agent-types';
import {createReviewMiddleware, parseReviewResumeActionPayload, type ReviewMiddlewareOptions} from '@core/middleware/review';
import {createMiddleware} from '@core/pipeline/types';

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

      const repeated = readAskUserContinuationState(input.context.runtime.context);
      if (repeated) {
        return {
          decision: 'deny',
          message: new ToolMessage({
            content: buildRepeatedAskUserMessage(repeated),
            tool_call_id: input.context.execution.toolCallId ?? input.context.toolCall.id ?? ASK_USER_TOOL_NAME,
            artifact: {
              type: 'ask_user_internal',
              visibility: 'hidden',
              reason: 'continuation_guard',
            },
          }),
        };
      }

      const ask = parseAskUserInput(input.context.toolCall.args);
      return {
        decision: 'ask',
        config: {
          description: ask.summary?.trim() || 'Additional user input is required before the agent can continue.',
          channel: ask.channel?.trim() || DEFAULT_CHANNEL,
          ui: {
            tab: ask.tab?.trim() || DEFAULT_TAB_LABEL,
            actions: buildAskUserActions(ask),
            form: {
              ...(ask.summary?.trim() ? {summary: ask.summary.trim()} : {}),
              tabs: ask.questions.map((question) => ({
                id: question.id,
                label: question.label,
                question: question.question,
                ...(question.input ? {input: question.input} : {}),
                ...(question.options?.length ? {options: question.options} : {}),
                ...(question.placeholder?.trim() ? {placeholder: question.placeholder.trim()} : {}),
              })),
            },
          },
          metadata: {
            codara: {
              interaction: {
                kind: 'ask-user',
              },
            },
          },
        },
      };
    },
    handleResume: async (request, resumePayload, context, handler) => {
      if (context.toolCall.name !== askUserToolName) {
        if (options.handleResume) {
          return options.handleResume(request, resumePayload, context, handler);
        }
        return handler(context);
      }

      const payload = parseReviewResumeActionPayload(resumePayload);
      const result = readAskUserResult(payload);
      writeAskUserContinuationState(context.runtime.runtimeContext, result);
      return new ToolMessage({
        content: JSON.stringify({
          ...result,
          guidance: ASK_USER_CONTINUATION_GUIDANCE,
        }),
        tool_call_id: request.action.toolCallId,
      });
    },
  });

  // Compose: review middleware handles wrapToolCall, we inject the AskUserQuestion tool
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
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }

    const record = parsed as Record<string, unknown>;
    const actionValue = record.action;
    const action = typeof actionValue === 'string'
      ? actionValue.trim()
      : '';
    const answersValue = record.answers;
    const commentValue = record.comment;
    if (!action || !answersValue || typeof answersValue !== 'object' || Array.isArray(answersValue)) {
      return undefined;
    }

    const answers = Object.fromEntries(
      Object.entries(answersValue).flatMap(([key, value]) => (
        normalizeAnswerEntry(key, value)
      )),
    );

    return {
      action,
      answers,
      ...(typeof commentValue === 'string' && commentValue.trim() ? {comment: commentValue.trim()} : {}),
    };
  } catch {
    return undefined;
  }
}

function buildAskUserActions(input: AskUserInput) {
  const actions: ReviewUIActionOption[] = [
    {id: 'submit', label: input.submitLabel?.trim() || DEFAULT_SUBMIT_LABEL, kind: 'primary' as const},
    {
    id: 'cancel',
    label: DEFAULT_CANCEL_LABEL,
    kind: 'secondary' as const,
    },
  ];

  return actions;
}

function parseAskUserInput(value: unknown): AskUserInput {
  const record = asRecord(value);
  if (!record) {
    throw new Error('AskUserQuestion arguments must be an object.');
  }

  const questions = readAskUserQuestions(record.questions);
  if (questions.length === 0) {
    throw new Error('AskUserQuestion requires at least one valid question.');
  }

  return normalizeAskUserInput({
    ...(normalizeStringLikeValue(record.summary) ? {summary: normalizeStringLikeValue(record.summary)} : {}),
    questions,
    ...(normalizeStringLikeValue(record.channel) ? {channel: normalizeStringLikeValue(record.channel)} : {}),
    ...(normalizeStringLikeValue(record.tab) ? {tab: normalizeStringLikeValue(record.tab)} : {}),
    ...(normalizeStringLikeValue(record.submitLabel) ? {submitLabel: normalizeStringLikeValue(record.submitLabel)} : {}),
  });
}

function readAskUserResult(payload: ReturnType<typeof parseReviewResumeActionPayload>): AskUserResult {
  const answers = readFormAnswers(payload.metadata);
  return {
    action: payload.action?.trim() || 'submit',
    answers,
    ...(payload.comment?.trim() ? {comment: payload.comment.trim()} : {}),
  };
}

function readFormAnswers(metadata: unknown): Record<string, AskUserAnswerValue> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  const form = (metadata as Record<string, unknown>).form;
  if (!form || typeof form !== 'object' || Array.isArray(form)) {
    return {};
  }

  const answers = (form as Record<string, unknown>).answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(answers).flatMap(([key, value]) => (
      normalizeAnswerEntry(key, value)
    )),
  );
}

function normalizeAnswerEntry(key: string, value: unknown): Array<[string, AskUserAnswerValue]> {
  if (!key.trim()) {
    return [];
  }

  if (typeof value === 'string') {
    return [[key, value]];
  }

  if (Array.isArray(value)) {
    const normalized = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    if (normalized.length > 0) {
      return [[key, normalized]];
    }
  }

  return [];
}

function normalizeAskUserInput(input: AskUserInput): AskUserInput {
  return {
    ...input,
    questions: input.questions
      .slice(0, MAX_ASK_USER_QUESTIONS)
      .map((question) => ({
        ...question,
        label: truncateAskUserLabel(question.label),
      })),
  };
}

function readAskUserContinuationState(runtimeContext: unknown): AskUserResult | undefined {
  const root = asRecord(runtimeContext);
  const codaraInteraction = asRecord(root?.codaraInteraction);
  const continuation = asRecord(codaraInteraction?.askUserContinuation);
  if (!continuation) {
    return undefined;
  }

  const action = normalizeStringLikeValue(continuation.action);
  if (action !== 'submit') {
    return undefined;
  }

  const answers = continuation.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return undefined;
  }

  const normalizedAnswers = Object.fromEntries(
    Object.entries(answers).flatMap(([key, value]) => normalizeAnswerEntry(key, value)),
  );
  if (Object.keys(normalizedAnswers).length === 0) {
    return undefined;
  }

  const comment = normalizeStringLikeValue(continuation.comment);
  return {
    action,
    answers: normalizedAnswers,
    ...(comment ? {comment} : {}),
  };
}

function buildRepeatedAskUserMessage(result: AskUserResult): string {
  return [
    ASK_USER_REPEAT_BLOCK_GUIDANCE,
    ASK_USER_CONTINUATION_GUIDANCE,
    `Collected answers: ${JSON.stringify(result.answers)}`,
    result.comment?.trim() ? `User comment: ${result.comment.trim()}` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function writeAskUserContinuationState(runtimeContext: Record<string, unknown> | undefined, result: AskUserResult): void {
  if (!runtimeContext) {
    return;
  }

  const codaraInteraction = asMutableRecord(runtimeContext.codaraInteraction);
  codaraInteraction.askUserContinuation = {
    action: result.action,
    answers: result.answers,
    ...(result.comment ? {comment: result.comment} : {}),
  };
  runtimeContext.codaraInteraction = codaraInteraction;
}

function truncateAskUserLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length <= MAX_ASK_USER_TAB_LABEL_LENGTH) {
    return trimmed;
  }

  return trimmed.slice(0, MAX_ASK_USER_TAB_LABEL_LENGTH);
}

function readAskUserQuestions(value: unknown): AskUserQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((question) => parseAskUserQuestion(question))
    .filter((question): question is AskUserQuestion => question !== undefined)
    .slice(0, MAX_ASK_USER_QUESTIONS);
}

function parseAskUserQuestion(value: unknown): AskUserQuestion | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const id = normalizeStringLikeValue(record.id);
  const label = normalizeStringLikeValue(record.label);
  const question = normalizeStringLikeValue(record.question);
  if (!id || !label || !question) {
    return undefined;
  }

  const input = normalizeQuestionInput(record.input);
  const options = readAskUserOptions(record.options);
  const placeholder = normalizeStringLikeValue(record.placeholder);

  return {
    id,
    label,
    question,
    ...(input ? {input} : {}),
    ...(options.length > 0 ? {options} : {}),
    ...(placeholder ? {placeholder} : {}),
  };
}

function readAskUserOptions(value: unknown): AskUserOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((option) => parseAskUserOption(option))
    .filter((option): option is AskUserOption => option !== undefined);
}

function parseAskUserOption(value: unknown): AskUserOption | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const id = normalizeStringLikeValue(record.id);
  const label = normalizeStringLikeValue(record.label);
  if (!id || !label) {
    return undefined;
  }

  const description = normalizeStringLikeValue(record.description);
  return {
    id,
    label,
    ...(description ? {description} : {}),
  };
}

function normalizeQuestionInput(value: unknown): AskUserQuestion['input'] | undefined {
  return value === 'select' || value === 'multiselect' || value === 'text'
    ? value
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asMutableRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? {...(value as Record<string, unknown>)}
    : {};
}

function normalizeStringLikeValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  for (const key of ['text', 'label', 'question', 'summary', 'description', 'title', 'value']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

export {ASK_USER_TOOL_NAME};
