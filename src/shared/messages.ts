import {AIMessage, type BaseMessage} from '@langchain/core/messages';

export function readMessageText(message: BaseMessage | undefined): string | undefined {
  const text = message?.text.trim();
  return text ? text : undefined;
}

export function readVisibleMessageText(message: BaseMessage | undefined): string | undefined {
  const text = readMessageText(message);
  if (!text) {
    return undefined;
  }

  const payload = parseHiddenRuntimePayload(text);
  if (payload === 'review_pause') {
    return undefined;
  }

  return text;
}

export function readLatestAssistantText(messages: readonly BaseMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (AIMessage.isInstance(message)) {
      const text = readVisibleMessageText(message);
      if (text) {
        return text;
      }
    }
  }
}

export function readLatestVisibleMessageText(messages: readonly BaseMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = readVisibleMessageText(messages[index]);
    if (text) {
      return text;
    }
  }
}

function parseHiddenRuntimePayload(text: string): 'review_pause' | undefined {
  if (!text.startsWith('{') || !text.includes('"type"')) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    return (parsed as Record<string, unknown>).type === 'review_pause' ? 'review_pause' : undefined;
  } catch {
    return undefined;
  }
}
