import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AIMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agent';
import {TASK_TOOL_NAME, createTaskTool} from '@capability/task/middleware';
import {FileSystemSkillStore} from '@capability/skill';
import {createAgentSkillsMiddleware, ScriptedModel} from './task-tool.fixtures';

describe('createTaskTool limits', () => {
  it('应应用 profile.maxTurns 作为子代理默认上限', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-task-tool-maxturns-'));

    try {
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
              name: TASK_TOOL_NAME,
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
          createTaskTool({
            model: childModel as unknown as BaseChatModel,
            tools: [
              tool(async () => 'read_ok', {name: 'read_file', description: 'read', schema: z.object({})}),
            ],
          }),
        ],
      });

      const result = await parent.invoke('delegate this');
      const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

      expect(result.reason).toBe('complete');
      expect(String(toolMessage.content)).toContain('reason: max_turns');
      expect(String(toolMessage.content)).toContain('turns: 1');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
