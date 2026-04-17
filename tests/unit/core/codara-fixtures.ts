import {AIMessage, AIMessageChunk, HumanMessage, SystemMessage, type BaseMessage} from '@langchain/core/messages';
import type {SkillMetadata, SkillStore} from '@skills';

export class EmptySkillStore implements SkillStore {
  async discover(): Promise<SkillMetadata[]> {
    return [];
  }
}

export class EchoModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const humanCount = messages.filter((message) => HumanMessage.isInstance(message)).length;
    return new AIMessage(`seen_humans:${humanCount}`);
  }

  bindTools(): this {
    return this;
  }
}

export class StreamingEchoModel extends EchoModel {
  async stream(messages: BaseMessage[]): Promise<AsyncGenerator<AIMessageChunk>> {
    const response = await this.invoke(messages);
    const text = String(response.content);

    return (async function* () {
      yield new AIMessageChunk(text);
    })();
  }
}

export class SystemEchoModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const systemText = messages
      .filter((message) => SystemMessage.isInstance(message))
      .map((message) => String(message.content))
      .join('\n---\n');

    return new AIMessage(systemText);
  }

  bindTools(): this {
    return this;
  }
}

export class FakeModel {
  private index = 0;

  constructor(private readonly responses: AIMessage[]) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    void messages;
    const current = this.responses[this.index];
    if (!current) {
      throw new Error(`No fake response at index ${this.index}`);
    }

    this.index += 1;
    return current;
  }

  bindTools(): this {
    return this;
  }
}

export function stringifyContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => JSON.stringify(item)).join('\n');
  }
  return JSON.stringify(content);
}
