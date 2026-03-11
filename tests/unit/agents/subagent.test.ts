import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agents';
import {createSubagentTool, DEFAULT_SUBAGENT_TOOL_NAME, readDelegatedAgentResult} from '@core/tasking';
import {createAgentMemoryCheckpointer} from '@core/checkpoint';

class ScriptedModel {
  private index = 0;
  boundToolNames: string[] = [];

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
    this.boundToolNames = tools.map((candidate) => candidate.name);
    return this;
  }
}

class HumanCountModel {
  boundToolNames: string[] = [];

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const humanCount = messages.filter((message) => HumanMessage.isInstance(message)).length;
    return new AIMessage(`child_humans:${humanCount}`);
  }

  bindTools(tools: StructuredToolInterface[]): this {
    this.boundToolNames = tools.map((candidate) => candidate.name);
    return this;
  }
}

describe('createSubagentTool', () => {
  it('应创建隔离子代理并将摘要回传给父代理', async () => {
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_subagent_1',
          name: DEFAULT_SUBAGENT_TOOL_NAME,
          args: {prompt: 'Inspect the task in a fresh context'},
        } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]);
    const childModel = new HumanCountModel();
    const subagentTool = createSubagentTool({model: childModel as unknown as BaseChatModel});

    const parent = createAgent({
      model: parentModel as unknown as BaseChatModel,
      tools: [subagentTool],
    });

    const result = await parent.invoke({messages: [new HumanMessage('parent_request')]});
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

    expect(result.reason).toBe('complete');
    expect(toolMessage.content).toContain('Subagent completed.');
    expect(toolMessage.content).toContain('summary:\nchild_humans:1');
    expect(readDelegatedAgentResult(toolMessage.artifact)).toEqual({
      type: 'delegated_agent_result',
      agentType: 'subagent',
      threadId: expect.any(String),
      turns: 1,
      reason: 'complete',
      summary: 'child_humans:1',
    });
  });

  it('应在子代理中排除同名 subagent 工具，禁止嵌套委派', async () => {
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_subagent_2',
          name: DEFAULT_SUBAGENT_TOOL_NAME,
          args: {prompt: 'Run a child task'},
        } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]);
    const childModel = new ScriptedModel([new AIMessage('child_done')]);
    const echoTool = tool(async () => 'pong', {
      name: 'echo',
      description: 'Echo tool',
      schema: z.object({}),
    });
    const nestedTool = createSubagentTool({
      model: new ScriptedModel([new AIMessage('nested_done')]) as unknown as BaseChatModel,
      tools: [echoTool],
    });
    const subagentTool = createSubagentTool({
      model: childModel as unknown as BaseChatModel,
      tools: [echoTool, nestedTool],
    });

    const parent = createAgent({
      model: parentModel as unknown as BaseChatModel,
      tools: [subagentTool],
    });

    const result = await parent.invoke('start');

    expect(result.reason).toBe('complete');
    expect(childModel.boundToolNames).toEqual(['echo']);
  });

  it('应基于 agentType 阻止不同名字的 subagent tool 继续派发', async () => {
    const nestedToolName = 'spawn_research_agent';
    const childModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_nested_subagent',
          name: nestedToolName,
          args: {prompt: 'nested'},
        } as ToolCall],
      }),
      new AIMessage('child_done'),
    ]);
    const renamedNestedTool = createSubagentTool({
      name: nestedToolName,
      model: new ScriptedModel([new AIMessage('nested_done')]) as unknown as BaseChatModel,
    });
    const child = createAgent({
      agentType: 'subagent',
      model: childModel as unknown as BaseChatModel,
      tools: [renamedNestedTool],
    });

    const result = await child.invoke('start');

    expect(result.reason).toBe('complete');
    const toolMessages = result.state.messages.filter((message) => ToolMessage.isInstance(message)) as ToolMessage[];
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]?.status).toBe('error');
    expect(String(toolMessages[0]?.content)).toContain('Subagents cannot delegate to other subagents');
  });

  it('应将子代理失败收敛成可解释的工具结果，而不是让父代理崩溃', async () => {
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_subagent_3',
          name: DEFAULT_SUBAGENT_TOOL_NAME,
          args: {prompt: 'This child will fail'},
        } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]);
    const failingChildModel = {
      async invoke(): Promise<AIMessage> {
        throw new Error('child boom');
      },
      bindTools(): unknown {
        return this;
      },
    } as unknown as BaseChatModel;
    const subagentTool = createSubagentTool({model: failingChildModel});

    const parent = createAgent({
      model: parentModel as unknown as BaseChatModel,
      tools: [subagentTool],
    });

    const result = await parent.invoke('start');
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

    expect(result.reason).toBe('complete');
    expect(toolMessage.content).toContain('Subagent failed.');
    expect(toolMessage.content).toContain('error: child boom');
    expect(toolMessage.status).toBe('error');
    expect(readDelegatedAgentResult(toolMessage.artifact)).toEqual({
      type: 'delegated_agent_result',
      agentType: 'subagent',
      threadId: expect.any(String),
      turns: 1,
      reason: 'error',
      errorMessage: 'child boom',
    });
  });

  it('应持久化 agentType，并在 checkpoint 恢复后保持 subagent 身份', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const child = createAgent({
      agentType: 'subagent',
      model: new ScriptedModel([new AIMessage('child_done')]) as unknown as BaseChatModel,
      checkpointer,
      threadId: 'subagent-thread',
    });

    const result = await child.invoke('start');
    expect(result.state.agentType).toBe('subagent');

    const checkpoint = await checkpointer.getLatest('subagent-thread');
    expect(checkpoint?.state.agentType).toBe('subagent');

    const restored = createAgent({
      model: new ScriptedModel([new AIMessage('restored_done')]) as unknown as BaseChatModel,
      checkpointer,
      threadId: 'subagent-thread',
      checkpoint,
    });

    expect(restored.getState().agentType).toBe('subagent');
  });
});
