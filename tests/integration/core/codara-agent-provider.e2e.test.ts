import {describe, expect, it} from 'bun:test';
import {createCodara, type MiddlewareLogRecord} from '@core';

describe('Codara facade with real provider', () => {
  it('should invoke through createCodara().invoke with a routing alias and logging', async () => {
    const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
    expect(Boolean(deepseekKey && !deepseekKey.startsWith('your-'))).toBe(true);
    const logs: MiddlewareLogRecord[] = [];

    const codara = createCodara({
      alias: 'deepseek',
      builtinTools: false,
      skills: false,
      logging: {
        enabled: true,
        level: 'debug',
        logger: (record) => {
          logs.push(record);
        },
      },
    });

    const result = await codara.invoke('只回复 OK，不要调用任何工具。');

    expect(result.reason).toBe('complete');
    expect(String(result.state.messages[result.state.messages.length - 1]?.content).trim().length).toBeGreaterThan(0);
    expect(logs.some((record) => record.stage === 'wrapModelCall' && record.event === 'stage_start')).toBe(true);
    expect(logs.some((record) => record.stage === 'afterAgent' && record.resultReason === 'complete')).toBe(true);
  }, 120_000);

  it('should stream message chunks through createCodara().stream with a routing alias and real model', async () => {
    const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
    expect(Boolean(deepseekKey && !deepseekKey.startsWith('your-'))).toBe(true);

    const codara = createCodara({
      alias: 'deepseek',
      builtinTools: false,
      skills: false,
    });

    const chunks: string[] = [];
    for await (const chunk of codara.stream('只回复 OK，不要调用任何工具。', {streamMode: 'messages'})) {
      const [messageChunk] = chunk as [{content: unknown}, {runId: string; turn: number}];
      chunks.push(String(messageChunk.content ?? ''));
    }

    expect(chunks.join('').trim().length).toBeGreaterThan(0);
    const session = await codara.session();
    expect(session.getState().sessionStatus).toBe('ready');
    expect(session.agent().getState().messages.length).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
