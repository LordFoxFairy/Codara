import {describe, expect, it} from 'bun:test';
import {AIMessage, type BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {createCodaraAgent} from '@core';

class CodaraTodoModel {
  readonly boundToolNames: string[] = [];

  bindTools(tools: Array<{name: string}>): this {
    this.boundToolNames.push(...tools.map((tool) => tool.name));
    return this;
  }

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    void messages;
    return new AIMessage('done');
  }
}

describe('Codara todo configuration', () => {
  it('should expose write_todos through the public Codara agent by default', async () => {
    const model = new CodaraTodoModel();
    const agent = await createCodaraAgent({
      model: model as unknown as BaseChatModel,
      guidelines: false,
      memory: false,
      skills: false,
      hil: false,
      builtinTools: false,
    });

    const result = await agent.invoke('hello');

    expect(result.reason).toBe('complete');
    expect(model.boundToolNames).toContain('write_todos');
  });

  it('should allow the public Codara agent to disable todo middleware explicitly', async () => {
    const model = new CodaraTodoModel();
    const agent = await createCodaraAgent({
      model: model as unknown as BaseChatModel,
      guidelines: false,
      memory: false,
      todo: false,
      skills: false,
      hil: false,
      builtinTools: false,
    });

    const result = await agent.invoke('hello');

    expect(result.reason).toBe('complete');
    expect(model.boundToolNames).not.toContain('write_todos');
  });
});
