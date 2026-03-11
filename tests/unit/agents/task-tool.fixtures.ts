import path from 'node:path';
import {AIMessage, HumanMessage, SystemMessage, type BaseMessage} from '@langchain/core/messages';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createSkillsMiddleware, FileSystemSkillStore} from '@core/skills';

export function createBuiltinSubagentStore() {
  return new FileSystemSkillStore({
    sources: [path.join(process.cwd(), '.codara', 'skills')],
    cacheTtlMs: 0,
  });
}

export function createAgentSkillsMiddleware(store: FileSystemSkillStore, subagentRoots?: string[]) {
  return createSkillsMiddleware({
    store,
    ...(subagentRoots?.length ? {subagentRoots} : {}),
  });
}

export class ScriptedModel {
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

  bindTools(tools: StructuredToolInterface[]): this {
    void tools;
    return this;
  }
}

export class ChildSummaryModel {
  boundToolNames: string[] = [];

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const humanCount = messages.filter((message) => HumanMessage.isInstance(message)).length;
    return new AIMessage(`task_child_humans:${humanCount}`);
  }

  bindTools(tools: StructuredToolInterface[]): this {
    this.boundToolNames = tools.map((tool) => tool.name);
    return this;
  }
}

export class SystemEchoModel {
  boundToolNames: string[] = [];

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const systemText = messages
      .filter((message) => SystemMessage.isInstance(message))
      .map((message) => String(message.content))
      .join('\n---\n');
    return new AIMessage(systemText);
  }

  bindTools(tools: StructuredToolInterface[]): this {
    this.boundToolNames = tools.map((tool) => tool.name);
    return this;
  }
}
