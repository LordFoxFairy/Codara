import {mapChatMessagesToStoredMessages, mapStoredMessagesToChatMessages} from '@langchain/core/messages';
import type {AgentState} from '@core/agents';
import type {SessionMetadata} from '@core/sessions/types';

export function createSessionMetadata(
  createdAt: string,
  restored?: Partial<SessionMetadata>,
  provided?: Partial<SessionMetadata>,
): SessionMetadata {
  return {
    messageCount: 0,
    lastActivity: createdAt,
    ...cloneSessionMetadata(restored),
    ...cloneSessionMetadata(provided),
  };
}

export function cloneSessionMetadata(
  metadata: Partial<SessionMetadata> | undefined,
): Partial<SessionMetadata> {
  if (!metadata) {
    return {};
  }

  return {
    ...metadata,
    ...(metadata.tags ? {tags: [...metadata.tags]} : {}),
    ...(metadata.usage ? {usage: {...metadata.usage}} : {}),
    ...(metadata.contextWindow ? {contextWindow: {...metadata.contextWindow}} : {}),
  };
}

export function touchSessionMetadata(metadata: SessionMetadata, updatedAt: string): void {
  metadata.lastActivity = updatedAt;
}

export function updateSessionMetadataFromAgentState(
  metadata: SessionMetadata,
  agentState: AgentState,
): void {
  metadata.messageCount = agentState.messages.length;

  const lastMessage = agentState.messages[agentState.messages.length - 1];
  const lastText = readMessageText(lastMessage?.content);
  if (lastText) {
    metadata.lastMessage = lastText.slice(0, 200);
  }

  if (!metadata.title) {
    const firstHuman = agentState.messages.find((message) => isMessageType(message, 'human'));
    const title = readMessageText(firstHuman?.content);
    if (title) {
      metadata.title = title.slice(0, 80);
    }
  }
}

export function cloneAgentMessages(messages: AgentState['messages']): AgentState['messages'] {
  return mapStoredMessagesToChatMessages(
    mapChatMessagesToStoredMessages(messages),
  ) as AgentState['messages'];
}

function readMessageText(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  return content
    .flatMap((part) => {
      if (!part || typeof part !== 'object') {
        return [];
      }

      if ('type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string') {
        return [part.text];
      }

      return [];
    })
    .join('\n')
    .trim() || undefined;
}

function isMessageType(message: unknown, expected: string): boolean {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if ('_getType' in message && typeof message._getType === 'function') {
    return message._getType() === expected;
  }

  if ('type' in message && typeof message.type === 'string') {
    return message.type === expected;
  }

  return false;
}
