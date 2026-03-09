import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {createAgent} from '@core/agents';
import {createAgentMemoryCheckpointer} from '@core/checkpoint';
import {MiddlewarePipeline} from '@core/middleware';
import {readTodoState, todoListMiddleware, TODO_TOOL_NAME} from '@core/middleware/todo';

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

describe('todoListMiddleware', () => {
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
      middlewares: [todoListMiddleware()],
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
    const middleware = todoListMiddleware();
    const pipeline = new MiddlewarePipeline([middleware]);
    const messages = [new HumanMessage('Hello')] as BaseMessage[];

    await pipeline.afterModel({
      state: {messages, context: {}, values: {}},
      messages,
      runtime: {context: {}, agentContext: {}},
      systemMessage: [],
      runId: 'run_todo',
      turn: 1,
      maxTurns: 3,
      requestId: 'req_todo',
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
      threadId: 'todo-thread',
      middlewares: [todoListMiddleware()],
    });

    const result = await agent.invoke({messages: [new HumanMessage('Implement todos')]});

    expect(result.reason).toBe('complete');
    expect(readTodoState(result.state.values).todos).toEqual([
      {content: 'Inspect codebase', status: 'completed'},
      {content: 'Implement todo middleware', status: 'in_progress'},
    ]);

    const restoredCheckpoint = await checkpointer.getLatest('todo-thread');
    expect(restoredCheckpoint).toBeDefined();

    const restored = createAgent({
      model: createTodoModel([new AIMessage('done')]),
      checkpointer,
      threadId: 'todo-thread',
      checkpoint: restoredCheckpoint,
      middlewares: [todoListMiddleware()],
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
      middlewares: [todoListMiddleware()],
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
      middlewares: [todoListMiddleware()],
    });

    const secondAgent = createAgent({
      model: createTodoModel([new AIMessage('done')]),
      middlewares: [todoListMiddleware()],
    });

    await firstAgent.invoke({messages: [new HumanMessage('Implement todos')]});

    expect(readTodoState(firstAgent.getState().values).todos).toEqual([
      {content: 'First agent task', status: 'in_progress'},
    ]);
    expect(readTodoState(secondAgent.getState().values).todos).toEqual([]);
  });
});

function createTodoModel(responses: AIMessage[]): BaseChatModel {
  return new TodoTestModel(responses) as unknown as BaseChatModel;
}
