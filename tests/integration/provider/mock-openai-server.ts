interface MockToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface MockChatResponse {
  content?: string;
  toolCalls?: MockToolCall[];
}

interface MockOpenAIServer {
  baseUrl: string;
  requests: Array<Record<string, unknown>>;
  stop(): void;
}

export function startMockOpenAIServer(responses: MockChatResponse[]): MockOpenAIServer {
  const queue = [...responses];
  const requests: Array<Record<string, unknown>> = [];

  const server = Bun.serve({
    port: 0,
    idleTimeout: 30,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
        return new Response('Not found', {status: 404});
      }

      const body = await request.json() as Record<string, unknown>;
      requests.push(body);

      const next = queue.shift();
      if (!next) {
        return Response.json({
          error: {
            message: 'No mock response available',
            type: 'invalid_request_error',
          },
        }, {status: 400});
      }

      return Response.json(createChatCompletion(next));
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    requests,
    stop() {
      server.stop(true);
    },
  };
}

export function createMockRoutingConfig(baseUrl: string) {
  return {
    providers: [
      {
        name: 'mock-openai',
        baseUrl,
        apiKey: 'test-key',
        models: [{id: 'mock-chat'}],
      },
    ],
    router: {
      mock: 'mock-openai:mock-chat',
    },
  };
}

function createChatCompletion(response: MockChatResponse) {
  const message = response.toolCalls?.length
    ? {
        role: 'assistant',
        content: response.content ?? null,
        tool_calls: response.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          },
        })),
      }
    : {
        role: 'assistant',
        content: response.content ?? '',
      };

  return {
    id: 'chatcmpl_mock',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'mock-chat',
    choices: [
      {
        index: 0,
        message,
        finish_reason: response.toolCalls?.length ? 'tool_calls' : 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 10,
      total_tokens: 20,
    },
  };
}
