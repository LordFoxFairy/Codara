import {describe, test, expect} from 'bun:test';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {markDelegationTool} from '@capability/task/delegation/agent';

describe('Task delegation recursion prevention', () => {
  test('markDelegationTool returns the same tool instance', () => {
    const myTool = tool(async () => 'ok', {name: 'Task', schema: z.object({})});
    const marked = markDelegationTool(myTool);
    expect(marked).toBe(myTool);
  });

  test('markDelegationTool sets the delegation symbol', () => {
    const myTool = tool(async () => 'ok', {name: 'Task', schema: z.object({})});
    markDelegationTool(myTool);
    const sym = Symbol.for('codara.tasks.delegation.tool');
    expect((myTool as unknown as Record<symbol, unknown>)[sym]).toBe(true);
  });

  test('unmarked tools do not have delegation symbol', () => {
    const myTool = tool(async () => 'ok', {name: 'bash', schema: z.object({})});
    const sym = Symbol.for('codara.tasks.delegation.tool');
    expect((myTool as unknown as Record<symbol, unknown>)[sym]).toBeUndefined();
  });
});
