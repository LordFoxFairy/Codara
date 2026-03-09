import {describe, expect, it} from 'bun:test';
import {HumanMessage, ToolMessage} from '@langchain/core/messages';
import {createAgent} from '@core/agents';
import {readTodoState, todoListMiddleware} from '@core/middleware/todo';
import {ChatModelFactory, loadModelRoutingConfig, ModelRegistry} from '@core/provider';

describe('Todo List Middleware End-to-End', () => {
  it('应在真实 agent 循环中调用 write_todos 并把 todos 持久化到 state.values', async () => {
    const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
    expect(Boolean(deepseekKey && !deepseekKey.startsWith('your-'))).toBe(true);

    const config = await loadModelRoutingConfig();
    const registry = new ModelRegistry(config);
    const factory = new ChatModelFactory(registry);
    const model = await factory.create('deepseek');

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

    expect(readTodoState(result.state.values).todos).toEqual([
      {content: 'Inspect current todo middleware flow', status: 'completed'},
      {content: 'Report final todo status to user', status: 'in_progress'},
    ]);
  }, 120_000);
});
