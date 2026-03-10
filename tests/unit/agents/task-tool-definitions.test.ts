import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AIMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agents';
import {createTaskTool, TASK_TOOL_NAME} from '@core/tasking';
import {FileSystemSkillStore} from '@core/skills';
import {createAgentSkillsMiddleware, ChildSummaryModel, ScriptedModel} from './task-tool.fixtures';

describe('createTaskTool definitions', () => {
  it('应从 skills 的 agents 目录解析自定义 profile', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-task-tool-profile-'));

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
      await writeFile(path.join(agentsDir, 'Researcher.md'), `---
name: Researcher
description: custom research profile
tools:
  - read
---
You are a Researcher subagent.
`, 'utf8');

      const childModel = new ChildSummaryModel();
      const parent = createAgent({
        model: new ScriptedModel([
          new AIMessage({
            content: '',
            tool_calls: [{
              id: 'call_task_custom_profile',
              name: TASK_TOOL_NAME,
              args: {
                prompt: 'Research the codebase',
                subagent_type: 'Researcher',
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
              tool(async () => 'ok', {name: 'read_file', description: 'read', schema: z.object({})}),
              tool(async () => 'ok', {name: 'grep', description: 'grep', schema: z.object({})}),
            ],
          }),
        ],
      });

      const result = await parent.invoke('delegate this');

      expect(result.reason).toBe('complete');
      expect(childModel.boundToolNames).toEqual(['read_file']);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('应支持通过独立 agents 目录解析 subagent_type', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-task-tool-agent-root-'));

    try {
      await writeFile(path.join(root, 'Reviewer.md'), `---
name: Reviewer
description: direct root reviewer
tools:
  - read
---
You are a Reviewer subagent loaded from a standalone agents root.
`, 'utf8');

      const childModel = new ChildSummaryModel();
      const parent = createAgent({
        model: new ScriptedModel([
          new AIMessage({
            content: '',
            tool_calls: [{
              id: 'call_task_agent_root',
              name: TASK_TOOL_NAME,
              args: {
                prompt: 'Review the implementation',
                subagent_type: 'Reviewer',
              },
            } as ToolCall],
          }),
          new AIMessage('done'),
        ]) as unknown as BaseChatModel,
        middleware: [createAgentSkillsMiddleware(new FileSystemSkillStore({sources: []}), [root])],
        tools: [
          createTaskTool({
            model: childModel as unknown as BaseChatModel,
            tools: [
              tool(async () => 'ok', {name: 'read_file', description: 'read', schema: z.object({})}),
              tool(async () => 'ok', {name: 'grep', description: 'grep', schema: z.object({})}),
            ],
          }),
        ],
      });

      const result = await parent.invoke('delegate this');

      expect(result.reason).toBe('complete');
      expect(childModel.boundToolNames).toEqual(['read_file']);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
