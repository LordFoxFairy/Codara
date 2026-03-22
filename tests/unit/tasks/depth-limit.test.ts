import {describe, test, expect} from 'bun:test';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {buildSubagentChildOptions} from '@capability/subagent/bootstrap';
import {AGENT_TOOL_NAME} from '@capability/subagent/tool';

describe('Task delegation recursion prevention', () => {
  test('buildSubagentChildOptions removes Agent delegation tools from child tool sets', async () => {
    const agentTool = tool(async () => 'ok', {name: AGENT_TOOL_NAME, schema: z.object({})});
    const bashTool = tool(async () => 'ok', {name: 'bash', schema: z.object({})});

    const child = await buildSubagentChildOptions({
      model: async () => ({}) as never,
      tools: [agentTool, bashTool],
    }, {
      prompt: 'child prompt',
      toolName: AGENT_TOOL_NAME,
      parentExecution: {
        sessionId: 'session',
        runId: 'run',
        turn: 1,
        requestId: 'request',
        toolIndex: 0,
        toolCallId: 'tool-call',
      },
    });

    expect(child.tools.map((entry) => entry.name)).toEqual(['bash']);
  });
});
