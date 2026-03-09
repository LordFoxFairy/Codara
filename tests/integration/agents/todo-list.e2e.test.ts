import {afterEach, describe, expect, it} from 'bun:test';
import {HumanMessage, ToolMessage} from '@langchain/core/messages';
import {createAgent} from '@core/agents';
import {readTodoState, todoListMiddleware} from '@core/middleware/todo';
import {ChatModelFactory, ModelRegistry, parseModelRoutingConfig} from '@core/provider';
import {createMockRoutingConfig, startMockOpenAIServer} from '../provider/mock-openai-server';

describe('Todo List Middleware End-to-End', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it('应在 provider stack 驱动的 agent 循环中调用 write_todos 并把 todos 持久化到 state.values', async () => {
    const server = startMockOpenAIServer([
      {
        toolCalls: [
          {
            id: 'call_todos_1',
            name: 'write_todos',
            arguments: {
              todos: [
                {content: 'Inspect current todo middleware flow', status: 'completed'},
                {content: 'Report final todo status to user', status: 'in_progress'},
              ],
            },
          },
        ],
      },
      {content: 'done'},
    ]);
    cleanups.push(() => server.stop());

    const config = parseModelRoutingConfig(createMockRoutingConfig(server.baseUrl));
    const registry = new ModelRegistry(config);
    const factory = new ChatModelFactory(registry);
    const model = await factory.create('mock');

    const runner = createAgent({
      model,
      middlewares: [todoListMiddleware()],
    });

    const result = await runner.invoke(
      {
        messages: [
          new HumanMessage(
            [
              '你必须严格按下面流程执行：',
              '1. 先且只先调用一次 write_todos。',
              '2. todos 里必须包含两项：',
              '   - content="Inspect current todo middleware flow", status="completed"',
              '   - content="Report final todo status to user", status="in_progress"',
              '3. 收到工具结果后，立即给出最终答复。',
              '4. 不要再次调用任何工具。',
            ].join('\n')
          ),
        ],
      },
      {recursionLimit: 8}
    );

    if (result.reason !== 'complete') {
      throw new Error(result.error?.message ?? `Unexpected result reason: ${result.reason}`);
    }

    const toolMessage = result.state.messages.find((message) => message instanceof ToolMessage) as ToolMessage;
    expect(toolMessage).toBeDefined();
    expect(String(toolMessage.content)).toContain('Updated todo list');
    expect(String(toolMessage.content)).toContain('Inspect current todo middleware flow');
    expect(String(toolMessage.content)).toContain('completed');
    expect(String(toolMessage.content)).toContain('Report final todo status to user');
    expect(String(toolMessage.content)).toContain('in_progress');

    expect(readTodoState(result.state.values).todos).toEqual([
      {content: 'Inspect current todo middleware flow', status: 'completed'},
      {content: 'Report final todo status to user', status: 'in_progress'},
    ]);
    expect(server.requests).toHaveLength(2);
  });
});
