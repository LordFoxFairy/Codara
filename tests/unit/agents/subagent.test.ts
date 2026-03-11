import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agents';
import {createHILMiddleware, createMiddleware} from '@core/middleware';
import {createAgentMemoryCheckpointer} from '@core/checkpoint';
import {readDelegatedAgentResult} from '@core/tasking/delegation';
import {TASK_TOOL_NAME, createTaskTool} from '@core/tasking/task';

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

class ChildProbeModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const systemText = messages
      .filter((message) => message.getType() === 'system')
      .map((message) => String(message.content))
      .join('\n---\n');
    const humanCount = messages.filter((message) => HumanMessage.isInstance(message)).length;
    return new AIMessage(`${systemText}\nchild_humans:${humanCount}`.trim());
  }

  bindTools(tools: StructuredToolInterface[]): this {
    void tools;
    return this;
  }
}

describe('Task delegation', () => {
  it('应通过默认 delegate 创建隔离子代理并将摘要回传给父代理', async () => {
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_1',
          name: TASK_TOOL_NAME,
          args: {prompt: 'Inspect the task in a fresh context'},
        } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]);
    const childModel = new HumanCountModel();
    const taskTool = createTaskTool({model: childModel as unknown as BaseChatModel});

    const parent = createAgent({
      model: parentModel as unknown as BaseChatModel,
      tools: [taskTool],
    });

    const result = await parent.invoke({messages: [new HumanMessage('parent_request')]});
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

    expect(result.reason).toBe('complete');
    expect(toolMessage.content).toContain('Delegated task completed.');
    expect(toolMessage.content).toContain('summary:\nchild_humans:1');
    expect(readDelegatedAgentResult(toolMessage.artifact)).toEqual({
      type: 'delegated_agent_result',
      threadId: expect.any(String),
      turns: 1,
      reason: 'complete',
      summary: 'child_humans:1',
    });
  });

  it('应在 child tools 中移除所有 delegation tools', async () => {
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_2',
          name: TASK_TOOL_NAME,
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
    const nestedTaskTool = createTaskTool({
      model: new ScriptedModel([new AIMessage('nested_done')]) as unknown as BaseChatModel,
      tools: [echoTool],
    });
    const taskTool = createTaskTool({
      model: childModel as unknown as BaseChatModel,
      tools: [echoTool, nestedTaskTool],
    });

    const parent = createAgent({
      model: parentModel as unknown as BaseChatModel,
      tools: [taskTool],
    });

    const result = await parent.invoke('start');

    expect(result.reason).toBe('complete');
    expect(childModel.boundToolNames).toEqual(['echo']);
    expect(childModel.boundToolNames).not.toContain(TASK_TOOL_NAME);
  });

  it('应将 child 失败收敛成可解释的 Task 结果，而不是让父代理崩溃', async () => {
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_3',
          name: TASK_TOOL_NAME,
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
    const taskTool = createTaskTool({model: failingChildModel});

    const parent = createAgent({
      model: parentModel as unknown as BaseChatModel,
      tools: [taskTool],
    });

    const result = await parent.invoke('start');
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

    expect(result.reason).toBe('complete');
    expect(toolMessage.content).toContain('Delegated task failed.');
    expect(toolMessage.content).toContain('error: child boom');
    expect(toolMessage.status).toBe('error');
    expect(readDelegatedAgentResult(toolMessage.artifact)).toEqual({
      type: 'delegated_agent_result',
      threadId: expect.any(String),
      turns: 1,
      reason: 'error',
      errorMessage: 'child boom',
    });
  });

  it('应为 delegated child 持久化 subagent checkpoint 身份', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const parent = createAgent({
      model: new ScriptedModel([
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_task_checkpoint',
            name: TASK_TOOL_NAME,
            args: {prompt: 'Persist the child checkpoint'},
          } as ToolCall],
        }),
        new AIMessage('done'),
      ]) as unknown as BaseChatModel,
      tools: [
        createTaskTool({
          model: new ScriptedModel([new AIMessage('child_done')]) as unknown as BaseChatModel,
          checkpointer,
        }),
      ],
    });

    const result = await parent.invoke('start');
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;
    const delegated = readDelegatedAgentResult(toolMessage.artifact);
    const checkpoint = delegated ? await checkpointer.getLatest(delegated.threadId) : undefined;

    expect(result.reason).toBe('complete');
    expect(delegated?.threadId).toBeDefined();
    expect(checkpoint?.state.agentType).toBe('subagent');
  });

  it('应默认隔离父代理的 messages、context、values 和 runtime.shared', async () => {
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_isolation',
          name: TASK_TOOL_NAME,
          args: {prompt: 'Inspect isolation'},
        } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]);

    const childProbe = createMiddleware({
      name: 'child-probe',
      beforeModel(context) {
        context.systemMessage.push(JSON.stringify({
          durableContext: context.state.context,
          runtimeContext: context.runtime.runtimeContext,
          runtimeShared: context.runtime.shared,
          values: context.state.values,
        }));
        return undefined;
      },
    });

    const taskTool = createTaskTool({
      model: new ChildProbeModel() as unknown as BaseChatModel,
      middleware: [childProbe],
    });

    const parent = createAgent({
      model: parentModel as unknown as BaseChatModel,
      tools: [taskTool],
      context: {parentContext: true},
      values: {parentValue: true},
      middleware: [
        createMiddleware({
          name: 'parent-runtime-shared',
          beforeModel: () => ({
            runtimeShared: {
              parentShared: true,
            },
          }),
        }),
      ],
    });

    const result = await parent.invoke({messages: [new HumanMessage('parent_request')]});
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

    expect(result.reason).toBe('complete');
    expect(String(toolMessage.content)).toContain('"durableContext":{}');
    expect(String(toolMessage.content)).toContain('"runtimeContext":{}');
    expect(String(toolMessage.content)).toContain('"runtimeShared":{}');
    expect(String(toolMessage.content)).toContain('"values":{}');
    expect(String(toolMessage.content)).toContain('child_humans:1');
    expect(String(toolMessage.content)).not.toContain('parent_request');
  });

  it('应只继承显式为 delegated child 提供的 context 和 values seed', async () => {
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_seeded',
          name: TASK_TOOL_NAME,
          args: {prompt: 'Inspect seeds'},
        } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]);

    const childProbe = createMiddleware({
      name: 'child-seed-probe',
      beforeModel(context) {
        context.systemMessage.push(JSON.stringify({
          durableContext: context.state.context,
          values: context.state.values,
        }));
        return undefined;
      },
    });

    const taskTool = createTaskTool({
      model: new ChildProbeModel() as unknown as BaseChatModel,
      middleware: [childProbe],
      context: {seededContext: 'child-only'},
      values: {seededValue: 1},
    });

    const parent = createAgent({
      model: parentModel as unknown as BaseChatModel,
      tools: [taskTool],
      context: {parentContext: true},
      values: {parentValue: true},
    });

    const result = await parent.invoke({messages: [new HumanMessage('parent_request')]});
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

    expect(result.reason).toBe('complete');
    expect(String(toolMessage.content)).toContain('"durableContext":{"seededContext":"child-only"}');
    expect(String(toolMessage.content)).toContain('"values":{"seededValue":1}');
    expect(String(toolMessage.content)).not.toContain('parentContext');
    expect(String(toolMessage.content)).not.toContain('parentValue');
  });

  it('应将 child HIL pause 提升到 parent，并在 resume 后继续 child checkpoint', async () => {
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_pause',
          name: TASK_TOOL_NAME,
          args: {prompt: 'Run guarded child task'},
        } as ToolCall],
      }),
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_pause',
          name: TASK_TOOL_NAME,
          args: {prompt: 'Run guarded child task'},
        } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]);
    const childModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'child_guarded_call',
          name: 'dangerous_tool',
          args: {path: 'guarded.txt'},
        } as ToolCall],
      }),
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'child_guarded_call',
          name: 'dangerous_tool',
          args: {path: 'guarded.txt'},
        } as ToolCall],
      }),
      new AIMessage('child_done'),
    ]);

    let dangerousInvokeCount = 0;
    const dangerousTool = tool(async () => {
      dangerousInvokeCount += 1;
      return 'dangerous:done';
    }, {
      name: 'dangerous_tool',
      description: 'Dangerous tool',
      schema: z.object({path: z.string()}),
    });

    const taskTool = createTaskTool({
      model: childModel as unknown as BaseChatModel,
      tools: [dangerousTool],
      middleware: [
        createHILMiddleware({
          interruptOn: {dangerous_tool: true},
        }),
      ],
    });

    const parent = createAgent({
      model: parentModel as unknown as BaseChatModel,
      tools: [taskTool],
    });

    const firstResult = await parent.invoke('start');

    expect(firstResult.reason).toBe('complete');
    expect(firstResult.state.status).toBe('paused');
    expect(firstResult.state.pendingPause?.metadata).toMatchObject({
      codara: {
        delegatedSubagent: {
          childThreadId: expect.any(String),
          parentToolName: TASK_TOOL_NAME,
        },
      },
    });
    expect(dangerousInvokeCount).toBe(0);

    const secondResult = await parent.resume(
      {decision: 'approve'},
      {
        recursionLimit: 4,
      },
    );

    expect(secondResult.reason).toBe('complete');
    expect(secondResult.state.status).toBe('idle');
    expect(secondResult.state.pendingPause).toBeUndefined();
    expect(dangerousInvokeCount).toBe(1);

    const delegatedToolMessages = secondResult.state.messages.filter((message) => ToolMessage.isInstance(message)) as ToolMessage[];
    const delegatedResult = readDelegatedAgentResult(delegatedToolMessages[delegatedToolMessages.length - 1]?.artifact);
    expect(delegatedResult?.reason).toBe('complete');
    expect(delegatedResult?.summary).toBe('child_done');
  });
});
