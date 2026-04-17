import {describe, test, expect} from 'bun:test';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {buildSubagentChildOptions} from '@tasks/subagent/bootstrap';
import {AGENT_TOOL_NAME} from '@tasks/subagent/tool';

describe('Task delegation recursion prevention', () => {
  test('buildSubagentChildOptions removes Agent delegation tools from child tool sets', async () => {
    const agentTool = tool(async () => 'ok', {name: AGENT_TOOL_NAME, schema: z.object({})});
    const bashTool = tool(async () => 'ok', {name: 'bash', schema: z.object({})});

    const child = await buildSubagentChildOptions({
      model: async () => ({}) as never,
      tools: [agentTool, bashTool],
    }, {
      profileTools: [agentTool, bashTool],
    });

    expect((child.tools ?? []).map((entry) => entry.name)).toEqual(['bash']);
  });

  test('buildSubagentChildOptions strips inherited skills prompt and propagates permissionMode', async () => {
    const child = await buildSubagentChildOptions({
      model: async () => ({}) as never,
      tools: [],
      childInstructionContext: {
        loadBaseSystemMessage: async () => ({
          systemMessage: [
            'project prompt',
            '## Skills System\n\nExecute a skill within the main conversation.\n\n{skills_list}',
          ],
          runtimeShared: {
            base: true,
            skills: {
              inherited: true,
            },
          },
        }),
      },
    }, {
      profileSystemPrompt: 'child prompt',
      permissionMode: 'plan',
    });

    expect((child.systemMessage ?? []).join('\n')).not.toContain('Skills System');
    expect(child.context).toMatchObject({permissionMode: 'plan'});
    expect(child.runtimeShared).toBeDefined();
    expect((child.runtimeShared as Record<string, unknown>).skills).toBeUndefined();
  });
});
