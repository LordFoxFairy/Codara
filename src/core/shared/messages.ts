import {AIMessage, type BaseMessage} from '@langchain/core/messages';

export function readMessageText(message: BaseMessage | undefined): string | undefined {
  const text = message?.text.trim();
  return text ? text : undefined;
}

export function readLatestAssistantText(messages: readonly BaseMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (AIMessage.isInstance(message)) {
      const text = readMessageText(message);
      if (text) {
        return text;
      }
    }
  }
}
