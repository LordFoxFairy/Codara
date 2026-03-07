import {describe, expect, it} from 'bun:test';
import {ToolMessage} from '@langchain/core/messages';
import {createCodara, type MiddlewareLogRecord} from '@core';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';

describe('Codara agent facade with real provider', () => {
  it('should invoke through createCodara().query with a routing alias, real model, tool call, and logging', async () => {
    const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
    expect(Boolean(deepseekKey && !deepseekKey.startsWith('your-'))).toBe(true);
    const echoTool = tool(async ({text}: {text: string}) => `ECHO:${text}`, {
      name: 'echo_text',
      description: 'Echo text back',
      schema: z.object({
        text: z.string(),
      }),
    });
    const logs: MiddlewareLogRecord[] = [];

    const codara = createCodara({
      alias: 'deepseek',
      tools: [echoTool],
      skills: false,
      logging: {
        enabled: true,
        level: 'debug',
        logger: (record) => {
          logs.push(record);
        },
      },
    });

    const result = await codara.query('你必须只调用一次 echo_text 工具，参数 text=ping。拿到结果后直接结束。');

    expect(result.reason).toBe('complete');

    const toolMessage = result.state.messages.find((message) => message instanceof ToolMessage) as ToolMessage | undefined;
    expect(toolMessage).toBeDefined();
    expect(String(toolMessage?.content ?? '')).toContain('ECHO:ping');

    expect(logs.some((record) => record.stage === 'wrapModelCall' && record.event === 'stage_start')).toBe(true);
    expect(logs.some((record) => record.stage === 'wrapToolCall' && record.event === 'stage_end')).toBe(true);
    expect(logs.some((record) => record.stage === 'afterAgent' && record.resultReason === 'complete')).toBe(true);
  }, 120_000);

  it('should stream message chunks through createCodara().stream with a routing alias and real model', async () => {
    const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
    expect(Boolean(deepseekKey && !deepseekKey.startsWith('your-'))).toBe(true);

    const codara = createCodara({
      alias: 'deepseek',
      skills: false,
    });

    const chunks: string[] = [];
    for await (const chunk of codara.stream('只回复 OK，不要调用任何工具。', {streamMode: 'messages'})) {
      const [messageChunk] = chunk as [ { content: unknown }, { runId: string; turn: number } ];
      chunks.push(String(messageChunk.content ?? ''));
    }

    expect(chunks.join('').trim().length).toBeGreaterThan(0);
    expect((await codara.getState()).messages.length).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
