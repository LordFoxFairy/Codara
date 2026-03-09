import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AIMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent, createTaskTool, TASK_TOOL_NAME} from '@core/agents';
import {createMiddleware} from '@core/middleware';
import {FileSystemSkillStore} from '@core/skills';
import {createAgentSkillsMiddleware, ChildSummaryModel, ScriptedModel, SystemEchoModel} from './task-tool.fixtures';

describe('createTaskTool runtime hints', () => {
  it('应通过 profile runtime resolver 消费 definition hints', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-task-tool-runtime-'));

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
      await writeFile(path.join(agentsDir, 'Reviewer.md'), `---
name: Reviewer
description: review profile
tools:
  - read
model: reviewer
middleware:
  - profile-tag
permissionMode: plan
---
You are a Reviewer subagent.
`, 'utf8');

      const childModel = new SystemEchoModel();
      const parent = createAgent({
        model: new ScriptedModel([
          new AIMessage({
            content: '',
            tool_calls: [{
              id: 'call_task_profile_runtime',
              name: TASK_TOOL_NAME,
              args: {
                prompt: 'Review the codebase',
                subagent_type: 'Reviewer',
              },
            } as ToolCall],
          }),
          new AIMessage('done'),
        ]) as unknown as BaseChatModel,
        middleware: [createAgentSkillsMiddleware(new FileSystemSkillStore({sources: [root], cacheTtlMs: 0}))],
        tools: [
          createTaskTool({
            model: new ChildSummaryModel() as unknown as BaseChatModel,
            tools: [
              tool(async () => 'ok', {name: 'read_file', description: 'read', schema: z.object({})}),
              tool(async () => 'ok', {name: 'grep', description: 'grep', schema: z.object({})}),
            ],
            runtimeHooks: {
              resolveDefinitionRuntime: (profile) => ({
                model: childModel as unknown as BaseChatModel,
                middleware: [
                  createMiddleware({
                    name: 'profile-tag',
                    wrapModelCall: (context, handler) => handler({
                      ...context,
                      systemMessage: context.systemMessage.concat(
                        `middleware:${profile.hints?.middlewareNames?.join(',') ?? '(none)'}`,
                        `profileModel:${profile.hints?.model ?? 'inherit'}`,
                        `permissionMode:${profile.hints?.permissionMode ?? 'none'}`,
                      ),
                    }),
                  }),
                ],
              }),
            },
          }),
        ],
      });

      const result = await parent.invoke('delegate this');
      const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

      expect(result.reason).toBe('complete');
      expect(childModel.boundToolNames).toEqual(['read_file']);
      expect(String(toolMessage.content)).toContain('permissionMode:plan');
      expect(String(toolMessage.content)).toContain('middleware:profile-tag');
      expect(String(toolMessage.content)).toContain('profileModel:reviewer');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
