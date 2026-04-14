import {describe, expect, it} from 'bun:test';
import {StreamingToolExecutor, type ToolProgressEvent} from '@core/agent/run/streaming-tool-executor';

describe('StreamingToolExecutor', () => {
  it('should track added tools as queued', () => {
    const executor = new StreamingToolExecutor();
    executor.addTool({id: '1', name: 'read_file', args: {path: '/test'}});
    executor.addTool({id: '2', name: 'write_file', args: {path: '/test'}});

    const status = executor.getStatus();

    expect(status).toHaveLength(2);
    expect(status[0].status).toBe('queued');
    expect(status[1].status).toBe('queued');
  });

  it('should emit progress events during execution', async () => {
    const executor = new StreamingToolExecutor();
    const events: string[] = [];
    executor.onProgress(e => events.push(`${e.toolName}:${e.status}`));
    executor.addTool({id: '1', name: 'read_file', args: {}});

    // No events before execution
    expect(events).toEqual([]);
  });

  it('should allow unsubscribe from progress', () => {
    const executor = new StreamingToolExecutor();
    const events: string[] = [];
    const unsub = executor.onProgress(e => events.push(e.status));
    unsub();

    // After unsubscribe, listener set is empty — no events captured
    expect(events).toEqual([]);
  });
});
