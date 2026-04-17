import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AIMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agent';
import {createSubagentRunMemoryStore, type SubagentRunRecord} from '@tasks/subagent';
import {AGENT_TOOL_NAME, createSubagentTool} from '@tasks/subagent/tool';
import {FileSystemSkillStore} from '@skills';
import {readSubagentRunLaunchResult} from '@shared/subagent-run-launch';
import {createAgentSkillsMiddleware, ScriptedModel} from './task-tool.fixtures';

async function waitForSubagentRunStatus(
  runStore: {get(runId: string): SubagentRunRecord | undefined},
  runId: string,
  status: SubagentRunRecord['status'],
): Promise<SubagentRunRecord> {
  const deadline = Date.now() + 500;

  while (Date.now() < deadline) {
    const record = runStore.get(runId);
    if (record?.status === status) {
      return record;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Agent run "${runId}" did not reach status "${status}"`);
}

describe('createSubagentTool limits', () => {
  it('应应用 profile.maxTurns 作为子代理默认上限', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-task-tool-maxturns-'));

    try {
      const runStore = createSubagentRunMemoryStore();
      const skillDir = path.join(root, 'custom-agents');
      const agentsDir = path.join(skillDir, 'agents');
      await mkdir(agentsDir, {recursive: true});
      await writeFile(path.join(skillDir, 'SKILL.md'), `---
name: custom-agents
description: custom task profiles
---
# Custom agents
`, 'utf8');
      await writeFile(path.join(agentsDir, 'ShortRunner.md'), `---
name: ShortRunner
description: short profile
tools:
  - read
maxTurns: 1
---
You are a short-running subagent.
`, 'utf8');

      const childModel = new ScriptedModel([
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_read_once',
            name: 'read_file',
            args: {},
          } as ToolCall],
        }),
        new AIMessage('done'),
      ]);

      const parent = createAgent({
        model: new ScriptedModel([
          new AIMessage({
            content: '',
            tool_calls: [{
              id: 'call_task_max_turns',
              name: AGENT_TOOL_NAME,
              args: {
                prompt: 'Run briefly',
                subagent_type: 'ShortRunner',
              },
            } as ToolCall],
          }),
          new AIMessage('done'),
        ]) as unknown as BaseChatModel,
        middleware: [createAgentSkillsMiddleware(new FileSystemSkillStore({sources: [root], cacheTtlMs: 0}))],
        tools: [
          createSubagentTool({
            model: childModel as unknown as BaseChatModel,
            tools: [
              tool(async () => 'read_ok', {name: 'read_file', description: 'read', schema: z.object({})}),
            ],
            runStore,
          }),
        ],
      });

      const result = await parent.invoke('delegate this');
      const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;
      const launch = readSubagentRunLaunchResult(toolMessage.artifact);
      const failed = launch ? await waitForSubagentRunStatus(runStore, launch.runId, 'failed') : undefined;

      expect(result.reason).toBe('complete');
      expect(String(toolMessage.content)).toContain('Subagent started in background.');
      expect(launch).toMatchObject({
        type: 'subagent_run_started',
        runId: 'call_task_max_turns',
        agentName: 'ShortRunner',
      });
      expect(failed).toMatchObject({
        runId: 'call_task_max_turns',
        status: 'failed',
        reason: 'max_turns',
        turns: 1,
      });
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
