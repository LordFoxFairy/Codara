/**
 * AskUserQuestion tool -- a real StructuredTool for requesting user input.
 *
 * Unlike the previous "fake tool" approach where call() returned a static error message,
 * this tool is a proper StructuredTool. The middleware intercepts via wrapToolCall
 * to trigger pause/resume before the tool's _call() is reached. If the middleware
 * is absent (e.g. in a headless pipeline), _call() returns a graceful fallback.
 */

import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {getAskUserToolPrompt} from './prompt';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AskUserInput = z.infer<typeof AskUserSchema>;
export type AskUserQuestion = z.infer<typeof AskUserQuestionSchema>;
export type AskUserOption = z.infer<typeof AskUserOptionSchema>;
export type AskUserAnswerValue = string | string[];

export interface AskUserResult {
  action: string;
  answers: Record<string, AskUserAnswerValue>;
  comment?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ASK_USER_TOOL_NAME = 'AskUserQuestion';
const MAX_ASK_USER_QUESTIONS = 4;
const MAX_ASK_USER_TAB_LABEL_LENGTH = 12;

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export class AskUserQuestionTool extends StructuredTool {
  name = ASK_USER_TOOL_NAME;
  description =
    'Request structured user input before the agent continues. ' +
    'Use this when key requirements, scope, priorities, or constraints are missing ' +
    'and proceeding would force guesses, weak plans, or wasted work. ' +
    'Prefer AskUserQuestion before reading files, planning architecture, or running exploratory steps ' +
    'when a small number of concrete user answers would materially change the next action. ' +
    'Keep AskUserQuestion concise: ask at most 4 questions, keep each tab/header label short (12 characters or fewer), ' +
    'and only ask the highest-leverage clarifications. ' +
    'Gather the needed clarification in one questionnaire whenever possible instead of chaining multiple AskUserQuestion calls back-to-back. ' +
    'Set each question input explicitly when possible: prefer select for one clear choice, multiselect for multiple choices, ' +
    'and text for pure free-form answers. The CLI already allows users to type a custom answer while reviewing any question, ' +
    'so use explicit options unless the question is truly free-form. ' +
    'If clarification is needed, call AskUserQuestion directly instead of only saying that you will ask questions. ' +
    'Once the user answers, continue the original task immediately instead of summarizing the questionnaire back to them ' +
    'or opening another questionnaire right away.';
  schema = AskUserSchema;

  /**
   * Graceful fallback when the middleware is not present.
   *
   * In normal operation, the AskUserQuestion middleware intercepts via
   * wrapToolCall and this method is never reached. If it IS reached
   * (e.g. headless pipeline, missing middleware), return a clear message
   * so the LLM can recover.
   */
  protected async _call(input: AskUserInput): Promise<string> {
    return JSON.stringify({
      action: 'skipped',
      answers: {},
      guidance:
        'AskUserQuestion is not available in this execution context (no interaction middleware). ' +
        'Proceed with reasonable defaults and note assumptions in your response.',
    });
  }
}

export function createAskUserTool(): AskUserQuestionTool {
  return new AskUserQuestionTool();
}

// ---------------------------------------------------------------------------
// Input parsing & normalization (used by the middleware)
// ---------------------------------------------------------------------------

export function parseAskUserInput(value: unknown): AskUserInput {
  const parsed = AskUserSchema.safeParse(value);
  if (parsed.success) {
    return normalizeInput(parsed.data);
  }

  const record = value as Record<string, unknown> | undefined;
  if (!record || typeof record !== 'object' || !Array.isArray(record.questions) || record.questions.length === 0) {
    throw new Error('AskUserQuestion requires at least one valid question.');
  }

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

// ---------------------------------------------------------------------------
// Result parsing (used by CLI components and event renderers)
// ---------------------------------------------------------------------------

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

export function normalizeAnswers(raw: Record<string, unknown>): Record<string, AskUserAnswerValue> {
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

export {getAskUserToolPrompt} from './prompt';
