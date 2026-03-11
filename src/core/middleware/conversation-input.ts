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
 * Internal conversation helper shared by model invocation and budget estimation.
 * It is not intended to be treated as a peer runtime stage.
 */
export function buildConversationMessages(input: ConversationModelInput): BuiltConversationMessages {
  const systemMessages = input.systemMessage.map((content) => new SystemMessage(content));
  return {
    systemMessages,
    modelMessages: [...systemMessages, ...input.messages],
  };
}
