import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {createAgent} from '@core/agent';
import {createAgentMemoryCheckpointer} from '@durability/checkpoint';
import {MiddlewarePipeline} from '@core/pipeline/pipeline';
import {readTodoState, createTodoListMiddleware, TODO_TOOL_NAME} from '@core/middleware/todo';

class TodoTestModel {
  readonly boundToolNames: string[] = [];
  private responses: AIMessage[];

  constructor(responses: AIMessage[]) {
    this.responses = [...responses];
  }

  bindTools(tools: Array<{name: string}>): this {
    this.boundToolNames.push(...tools.map((tool) => tool.name));
    return this;
  }

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    void messages;
    const response = this.responses.shift();
    if (!response) {
      throw new Error('No fake response available');
    }
    return response;
  }
}

describe('createTodoListMiddleware', () => {
  it('should register write_todos and persist todos in state.values', async () => {
    const model = new TodoTestModel([
      new AIMessage({
        content: 'Planning work',
        tool_calls: [
          {
            id: 'call_todos_1',
            name: TODO_TOOL_NAME,
            args: {
              todos: [
                {content: 'Inspect codebase', status: 'completed'},
                {content: 'Implement todo middleware', status: 'in_progress'},
              ],
            },
            type: 'tool_call',
          },
        ],
      }),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const agent = createAgent({
      model,
      middleware: [createTodoListMiddleware()],
    });

    const result = await agent.invoke({messages: [new HumanMessage('Implement todos')]});

    expect(result.reason).toBe('complete');
    expect((model as unknown as TodoTestModel).boundToolNames).toContain(TODO_TOOL_NAME);
    expect(readTodoState(result.state.values).todos).toEqual([
      {content: 'Inspect codebase', status: 'completed'},
      {content: 'Implement todo middleware', status: 'in_progress'},
    ]);
    expect(result.state.messages.some((message) => ToolMessage.isInstance(message))).toBe(true);
  });

  it('should reject parallel write_todos calls through afterModel updates', async () => {
    const middleware = createTodoListMiddleware();
    const pipeline = new MiddlewarePipeline([middleware]);
    const messages = [new HumanMessage('Hello')] as BaseMessage[];

    await pipeline.afterModel({
      state: {messages, context: {}, values: {}},
      messages,
      runtime: {context: {}},
      systemMessage: [],
      execution: {
        sessionId: 'thread_todo',
        runId: 'run_todo',
        turn: 1,
        maxTurns: 3,
        requestId: 'req_todo',
      },
      response: new AIMessage({
        content: 'I will update the todos',
        tool_calls: [
          {id: 'call_1', name: TODO_TOOL_NAME, args: {todos: [{content: 'Task 1', status: 'pending'}]}, type: 'tool_call'},
          {id: 'call_2', name: TODO_TOOL_NAME, args: {todos: [{content: 'Task 2', status: 'pending'}]}, type: 'tool_call'},
        ],
      }),
    });

    const toolMessages = messages.filter((message) => ToolMessage.isInstance(message)) as ToolMessage[];
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages.every((message) => message.status === 'error')).toBe(true);
  });

  it('should inject the current todo snapshot into model system messages', async () => {
    const seenSystemMessages: string[][] = [];
    const pipeline = new MiddlewarePipeline([createTodoListMiddleware()]);
    const messages = [new HumanMessage('Continue the task')] as BaseMessage[];

    await pipeline.wrapModelCall(
      {
        state: {
          messages,
          context: {},
          values: {
            todos: [
              {content: 'Inspect codebase', status: 'completed'},
              {content: 'Implement todo middleware', status: 'in_progress'},
            ],
          },
        },
        messages,
        runtime: {context: {}},
        systemMessage: [],
        execution: {
          sessionId: 'thread_todo_snapshot',
          runId: 'run_todo_snapshot',
          turn: 2,
          maxTurns: 3,
          requestId: 'req_todo_snapshot',
        },
      },
      async (request) => {
        seenSystemMessages.push([...(request?.systemMessage ?? [])]);
        return new AIMessage('done');
      }
    );

    expect(seenSystemMessages).toHaveLength(1);
    expect(seenSystemMessages[0]?.some((message) => message.includes('## Current To-Do List'))).toBe(true);
    expect(seenSystemMessages[0]?.some((message) => message.includes('[completed] Inspect codebase'))).toBe(true);
    expect(seenSystemMessages[0]?.some((message) => message.includes('[in_progress] Implement todo middleware'))).toBe(true);
  });

  it('should persist todos through checkpoint restore', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const agent = createAgent({
      model: createTodoModel([
        new AIMessage({
          content: 'Planning work',
          tool_calls: [
            {
              id: 'call_todos_restore',
              name: TODO_TOOL_NAME,
              args: {
                todos: [
                  {content: 'Inspect codebase', status: 'completed'},
                  {content: 'Implement todo middleware', status: 'in_progress'},
                ],
              },
              type: 'tool_call',
            },
          ],
        }),
        new AIMessage('done'),
      ]),
      checkpointer,
      sessionId: 'todo-session',
      middleware: [createTodoListMiddleware()],
    });

    const result = await agent.invoke({messages: [new HumanMessage('Implement todos')]});

    expect(result.reason).toBe('complete');
    expect(readTodoState(result.state.values).todos).toEqual([
      {content: 'Inspect codebase', status: 'completed'},
      {content: 'Implement todo middleware', status: 'in_progress'},
    ]);

    const restoredCheckpoint = await checkpointer.getLatest('todo-session');
    expect(restoredCheckpoint).toBeDefined();

    const restored = createAgent({
      model: createTodoModel([new AIMessage('done')]),
      checkpointer,
      sessionId: 'todo-session',
      checkpoint: restoredCheckpoint,
      middleware: [createTodoListMiddleware()],
    });

    expect(readTodoState(restored.getState().values).todos).toEqual([
      {content: 'Inspect codebase', status: 'completed'},
      {content: 'Implement todo middleware', status: 'in_progress'},
    ]);
  });

  it('should clear todos on reset', async () => {
    const agent = createAgent({
      model: createTodoModel([
        new AIMessage({
          content: 'Planning work',
          tool_calls: [
            {
              id: 'call_todos_reset',
              name: TODO_TOOL_NAME,
              args: {
                todos: [
                  {content: 'Inspect codebase', status: 'completed'},
                  {content: 'Implement todo middleware', status: 'in_progress'},
                ],
              },
              type: 'tool_call',
            },
          ],
        }),
        new AIMessage('done'),
      ]),
      middleware: [createTodoListMiddleware()],
    });

    await agent.invoke({messages: [new HumanMessage('Implement todos')]});
    expect(readTodoState(agent.getState().values).todos).toHaveLength(2);

    await agent.reset();

    expect(agent.getState().messages).toHaveLength(0);
    expect(readTodoState(agent.getState().values).todos).toEqual([]);
  });

  it('should keep todos isolated per agent instance', async () => {
    const firstAgent = createAgent({
      model: createTodoModel([
        new AIMessage({
          content: 'Planning work',
          tool_calls: [
            {
              id: 'call_todos_first',
              name: TODO_TOOL_NAME,
              args: {
                todos: [
                  {content: 'First agent task', status: 'in_progress'},
                ],
              },
              type: 'tool_call',
            },
          ],
        }),
        new AIMessage('done'),
      ]),
      middleware: [createTodoListMiddleware()],
    });

    const secondAgent = createAgent({
      model: createTodoModel([new AIMessage('done')]),
      middleware: [createTodoListMiddleware()],
    });

    await firstAgent.invoke({messages: [new HumanMessage('Implement todos')]});

    expect(readTodoState(firstAgent.getState().values).todos).toEqual([
      {content: 'First agent task', status: 'in_progress'},
    ]);
    expect(readTodoState(secondAgent.getState().values).todos).toEqual([]);
  });

  it('should order system messages: base → static prompt → dynamic snapshot (prompt caching stability)', async () => {
    const seenSystemMessages: string[][] = [];
    const pipeline = new MiddlewarePipeline([createTodoListMiddleware()]);
    const messages = [new HumanMessage('Continue')] as BaseMessage[];
    const baseSystem = 'You are a helpful assistant.';

    await pipeline.wrapModelCall(
      {
        state: {
          messages,
          context: {},
          values: {
            todos: [{content: 'Step 1', status: 'in_progress'}],
          },
        },
        messages,
        runtime: {context: {}},
        systemMessage: [baseSystem],
        execution: {
          sessionId: 'thread_cache',
          runId: 'run_cache',
          turn: 1,
          maxTurns: 3,
          requestId: 'req_cache',
        },
      },
      async (request) => {
        seenSystemMessages.push([...(request?.systemMessage ?? [])]);
        return new AIMessage('ok');
      }
    );

    expect(seenSystemMessages).toHaveLength(1);
    const msgs = seenSystemMessages[0]!;
    // Order: [0] base → [1] static todo prompt → [2] dynamic snapshot
    expect(msgs[0]).toBe(baseSystem);
    expect(msgs[1]).toContain('## `write_todos`');
    expect(msgs[2]).toContain('## Current To-Do List');
    expect(msgs[2]).toContain('[in_progress] Step 1');
  });

  it('should reject invalid seeded todo state', () => {
    expect(() => createAgent({
      model: createTodoModel([new AIMessage('done')]),
      middleware: [createTodoListMiddleware()],
      values: {
        todos: 'invalid',
      } as unknown as Record<string, unknown>,
    })).toThrow('Middleware "TodoListMiddleware" state validation failed');
  });
});

function createTodoModel(responses: AIMessage[]): BaseChatModel {
  return new TodoTestModel(responses) as unknown as BaseChatModel;
}
