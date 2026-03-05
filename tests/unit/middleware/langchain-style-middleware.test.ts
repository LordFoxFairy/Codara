import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, type BaseMessage} from '@langchain/core/messages';
import {createMiddleware, MiddlewarePipeline} from '@core/middleware';

function createContext() {
  const messages = [new HumanMessage('hello')] as BaseMessage[];
  return {
    state: {messages},
    messages,
    runtime: {context: {}},
    systemMessage: [],
    runId: 'run_style',
    turn: 1,
    maxTurns: 3,
    requestId: 'req_style'
  };
}

describe('LangChain-style middleware ergonomics', () => {
  it('应支持 beforeModel/afterModel 直接读取 state.messages', async () => {
    const logs: string[] = [];

    const loggingMiddleware = createMiddleware({
      name: 'LoggingMiddleware',
      beforeModel: (state) => {
        logs.push(`About to call model with ${state.messages.length} messages`);
      },
      afterModel: (state) => {
        const lastMessage = state.messages[state.messages.length - 1];
        logs.push(`Model returned: ${String(lastMessage?.content ?? '')}`);
      }
    });

    const pipeline = new MiddlewarePipeline([loggingMiddleware]);
    const context = createContext();

    await pipeline.beforeModel(context);
    await pipeline.afterModel({...context, response: new AIMessage('ok')});

    expect(logs).toEqual([
      'About to call model with 1 messages',
      'Model returned: hello'
    ]);
  });

  it('应支持 RetryMiddleware 风格的 wrapModelCall(request, handler)', async () => {
    const retryLogs: string[] = [];

    const createRetryMiddleware = (maxRetries: number = 3) =>
      createMiddleware({
        name: 'RetryMiddleware',
        wrapModelCall: async (request, handler) => {
          for (let attempt = 0; attempt < maxRetries; attempt += 1) {
            try {
              return await handler(request);
            } catch (error) {
              if (attempt === maxRetries - 1) {
                throw error;
              }
              retryLogs.push(`Retry ${attempt + 1}/${maxRetries} after error`);
            }
          }
          throw new Error('Unreachable');
        }
      });

    const context = createContext();
    const pipeline = new MiddlewarePipeline([createRetryMiddleware(3)]);
    let attempts = 0;

    const response = await pipeline.wrapModelCall(context, async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error('transient model error');
      }
      return new AIMessage('ok');
    });

    expect(String(response.content)).toBe('ok');
    expect(attempts).toBe(2);
    expect(retryLogs).toEqual(['Retry 1/3 after error']);
  });
});
