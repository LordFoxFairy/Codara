import {AIMessage, HumanMessage, SystemMessage, type BaseMessage} from '@langchain/core/messages';
import {readMessageText} from '@core/shared/messages';
import type {CliActiveTurn, CliNotice} from '../app/view-state';

export type TranscriptRole = 'system' | 'warning' | 'user' | 'assistant' | 'error';

export interface TranscriptItem {
  id: string;
  role: TranscriptRole;
  content: string;
}

export interface BuildTranscriptItemsInput {
  coreMessages: readonly BaseMessage[];
  notices: readonly CliNotice[];
  activeTurn?: CliActiveTurn;
  limit?: number;
}

export interface HasTranscriptContentInput {
  coreMessages: readonly BaseMessage[];
  notices: readonly CliNotice[];
  activeTurn?: CliActiveTurn;
  initialNoticeCount?: number;
}

export const DEFAULT_TRANSCRIPT_LIMIT = 12;

export function buildTranscriptItems(input: BuildTranscriptItemsInput): TranscriptItem[] {
  const items = [
    ...input.notices.map((notice) => ({
      id: notice.id,
      role: notice.level,
      content: notice.content,
    })),
    ...input.coreMessages.map((message, index) => ({
      id: String(message.id ?? `${message.getType()}-${index}`),
      role: mapCoreMessageRole(message),
      content: readMessageText(message) || '',
    })),
    ...(input.activeTurn
      ? [
          {
            id: `${input.activeTurn.id}-prompt`,
            role: 'user' as const,
            content: input.activeTurn.prompt,
          },
          {
            id: `${input.activeTurn.id}-response`,
            role: input.activeTurn.responseRole,
            content: input.activeTurn.response,
          },
        ]
      : []),
  ];

  return items
    .filter((item) => item.content)
    .slice(-(input.limit ?? DEFAULT_TRANSCRIPT_LIMIT));
}

export function hasTranscriptContent(input: HasTranscriptContentInput): boolean {
  if (input.activeTurn) {
    return true;
  }

  if (input.notices.length > (input.initialNoticeCount ?? 0)) {
    return true;
  }

  return input.coreMessages.some((message) => {
    const text = readMessageText(message);
    return Boolean(text && (HumanMessage.isInstance(message) || AIMessage.isInstance(message) || SystemMessage.isInstance(message)));
  });
}

function mapCoreMessageRole(message: BaseMessage): TranscriptRole {
  if (HumanMessage.isInstance(message)) {
    return 'user';
  }

  if (AIMessage.isInstance(message)) {
    return 'assistant';
  }

  return 'system';
}
