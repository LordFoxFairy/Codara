import {SystemMessage, type BaseMessage} from '@langchain/core/messages';

export interface ConversationModelInput {
  systemMessage: string[];
  messages: BaseMessage[];
}

export interface BuiltConversationMessages {
  systemMessages: SystemMessage[];
  modelMessages: BaseMessage[];
}

/**
 * Build the exact message list that will be sent to the model.
 *
 * This helper is intentionally shared by runtime stages and budgeting logic so
 * conversation input assembly does not drift across the stack.
 */
export function buildConversationMessages(input: ConversationModelInput): BuiltConversationMessages {
  const systemMessages = input.systemMessage.map((content) => new SystemMessage(content));
  return {
    systemMessages,
    modelMessages: [...systemMessages, ...input.messages],
  };
}
