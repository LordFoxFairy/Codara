import {ToolMessage} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import type {PauseUIActionOption} from '@core/agents';
import {createHILMiddleware, parseHILResumeActionPayload, type HILMiddlewareOptions} from '@core/middleware/hil';

const ASK_USER_TOOL_NAME = 'AskUser';
const DEFAULT_CHANNEL = 'interaction-center';
const DEFAULT_TAB_LABEL = 'User Input';
const DEFAULT_SUBMIT_LABEL = 'Submit';
const DEFAULT_CHAT_LABEL = 'Chat about this';

const AskUserOptionSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string().trim().optional(),
});

const AskUserQuestionSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  question: z.string().trim().min(1),
  input: z.enum(['select', 'multiselect', 'text', 'mixed']).optional(),
  options: z.array(AskUserOptionSchema).optional(),
  placeholder: z.string().trim().optional(),
});

export const AskUserSchema = z.object({
  summary: z.string().trim().optional(),
  questions: z.array(AskUserQuestionSchema).min(1),
  allowChat: z.boolean().optional(),
  channel: z.string().trim().optional(),
  tab: z.string().trim().optional(),
  submitLabel: z.string().trim().optional(),
  chatLabel: z.string().trim().optional(),
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

export interface InteractionMiddlewareOptions extends Omit<HILMiddlewareOptions, 'interruptOn'> {
  askUserToolName?: string;
}

export function createAskUserTool() {
  return tool(
    async () => 'AskUser requires interaction middleware to pause and collect user input.',
    {
      name: ASK_USER_TOOL_NAME,
      description: 'Request structured user input before the agent continues. Use this when key requirements, scope, priorities, or constraints are missing and proceeding would force guesses, weak plans, or wasted work. Prefer AskUser before reading files, planning architecture, or running exploratory steps when a small number of concrete user answers would materially change the next action. If clarification is needed, call AskUser directly instead of only saying that you will ask questions.',
      schema: AskUserSchema,
    },
  );
}

export function createInteractionMiddleware(options: InteractionMiddlewareOptions = {}) {
  const askUserToolName = options.askUserToolName?.trim() || ASK_USER_TOOL_NAME;

  return createHILMiddleware({
    ...options,
    name: options.name?.trim() || 'InteractionMiddleware',
    resolveDecision: async (input) => {
      if (input.context.toolCall.name !== askUserToolName) {
        return options.resolveDecision?.(input);
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

      const payload = parseHILResumeActionPayload(resumePayload);
      const result = readAskUserResult(payload);
      return new ToolMessage({
        content: JSON.stringify(result),
        tool_call_id: request.action.toolCallId,
      });
    },
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
  const actions: PauseUIActionOption[] = [
    {id: 'submit', label: input.submitLabel?.trim() || DEFAULT_SUBMIT_LABEL, kind: 'primary' as const},
  ];

  if (input.allowChat !== false) {
    actions.push({
      id: 'chat',
      label: input.chatLabel?.trim() || DEFAULT_CHAT_LABEL,
      kind: 'secondary' as const,
    });
  }

  return actions;
}

function parseAskUserInput(value: unknown): AskUserInput {
  return AskUserSchema.parse(value);
}

function readAskUserResult(payload: ReturnType<typeof parseHILResumeActionPayload>): AskUserResult {
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

export {ASK_USER_TOOL_NAME};
