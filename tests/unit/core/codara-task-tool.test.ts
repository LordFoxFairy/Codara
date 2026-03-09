import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AIMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {createMiddleware} from '@core/middleware';
import {
  createCodaraAgent,
  createCodaraTaskTool,
  TASK_TOOL_NAME,
} from '@core';
import {FakeModel, SystemEchoModel} from './codara-fixtures';

describe('Codara task profile runtime', () => {
  it('should keep the inherited Codara assembly instead of auto-switching model or middleware from the profile', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-task-profile-runtime-'));

    try {
      const skillDir = path.join(root, 'custom-agents');
      const agentsDir = path.join(skillDir, 'agents');
      await mkdir(agentsDir, {recursive: true});
      await writeFile(path.join(skillDir, 'SKILL.md'), `---
name: custom-agents
description: shared skills runtime
---
# Shared runtime
`, 'utf8');
      await writeFile(path.join(agentsDir, 'Reviewer.md'), `---
name: Reviewer
description: review runtime
tools:
  - read
model: reviewer
middleware:
  - child-only
permissionMode: plan
maxTurns: 6
---
You are a Reviewer subagent.
`, 'utf8');

      const inheritedTag = createMiddleware({
        name: 'inherited-tag',
        wrapModelCall: (context, handler) => handler({
          ...context,
          systemMessage: context.systemMessage.concat(
            'inherited-tag-active',
          ),
        }),
      });

      const taskTool = await createCodaraTaskTool({
        model: new SystemEchoModel() as unknown as BaseChatModel,
        builtinTools: false,
        tools: [
          tool(async () => 'ok', {name: 'read_file', description: 'read', schema: z.object({})}),
        ],
        middleware: [inheritedTag],
        skills: {
          store: {
            discover: async () => [{
              name: 'custom-agents',
              description: 'shared skills runtime',
              path: path.join(skillDir, 'SKILL.md'),
            }],
            listSources: () => [root],
          },
        },
      });

      const parent = await createCodaraAgent({
        model: new FakeModel([
          new AIMessage({
            content: '',
            tool_calls: [{
              id: 'call_codara_task_profile_runtime',
              name: TASK_TOOL_NAME,
              args: {
                prompt: 'Review the implementation',
                subagent_type: 'Reviewer',
              },
            } as ToolCall],
          }),
          new AIMessage('done'),
        ]) as unknown as BaseChatModel,
        builtinTools: false,
        tools: [taskTool],
        skills: {
          store: {
            discover: async () => [{
              name: 'custom-agents',
              description: 'shared skills runtime',
              path: path.join(skillDir, 'SKILL.md'),
            }],
            listSources: () => [root],
          },
        },
      });

      const result = await parent.invoke('delegate this');
      const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

      expect(result.reason).toBe('complete');
      expect(String(toolMessage.content)).toContain('Skills System');
      expect(String(toolMessage.content)).toContain('inherited-tag-active');
      expect(String(toolMessage.content)).toContain('You are a Reviewer subagent.');
      expect(String(toolMessage.content)).not.toContain('child-only');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should let subagents reuse the same Codara skills and middleware assembly as the main agent', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-shared-subagent-assembly-'));

    try {
      const skillDir = path.join(root, 'custom-agents');
      const agentsDir = path.join(skillDir, 'agents');
      await mkdir(agentsDir, {recursive: true});
      await writeFile(path.join(skillDir, 'SKILL.md'), `---
name: custom-agents
description: shared skills runtime
---
# Shared runtime
`, 'utf8');
      await writeFile(path.join(agentsDir, 'Reviewer.md'), `---
name: Reviewer
description: review runtime
tools:
  - read
---
You are a Reviewer subagent.
`, 'utf8');

      const taskTool = await createCodaraTaskTool({
        model: new SystemEchoModel() as unknown as BaseChatModel,
        builtinTools: false,
        tools: [
          tool(async () => 'ok', {name: 'read_file', description: 'read', schema: z.object({})}),
        ],
        skills: {
          store: {
            discover: async () => [{
              name: 'custom-agents',
              description: 'shared skills runtime',
              path: path.join(skillDir, 'SKILL.md'),
            }],
            listSources: () => [root],
          },
        },
      });

      const parent = await createCodaraAgent({
        model: new FakeModel([
          new AIMessage({
            content: '',
            tool_calls: [{
              id: 'call_codara_task',
              name: TASK_TOOL_NAME,
              args: {
                prompt: 'Review the implementation',
                subagent_type: 'Reviewer',
              },
            } as ToolCall],
          }),
          new AIMessage('done'),
        ]) as unknown as BaseChatModel,
        builtinTools: false,
        tools: [taskTool],
        skills: {
          store: {
            discover: async () => [{
              name: 'custom-agents',
              description: 'shared skills runtime',
              path: path.join(skillDir, 'SKILL.md'),
            }],
            listSources: () => [root],
          },
        },
      });

      const result = await parent.invoke('delegate this');
      const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

      expect(result.reason).toBe('complete');
      expect(String(toolMessage.content)).toContain('Skills System');
      expect(String(toolMessage.content)).toContain('custom-agents');
      expect(String(toolMessage.content)).toContain('You are a Reviewer subagent.');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should ignore profile middleware declarations that are not part of the inherited assembly', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-task-profile-middleware-'));

    try {
      const skillDir = path.join(root, 'custom-agents');
      const agentsDir = path.join(skillDir, 'agents');
      await mkdir(agentsDir, {recursive: true});
      await writeFile(path.join(skillDir, 'SKILL.md'), `---
name: custom-agents
description: shared skills runtime
---
# Shared runtime
`, 'utf8');
      await writeFile(path.join(agentsDir, 'Reviewer.md'), `---
name: Reviewer
description: review runtime
tools:
  - read
middleware:
  - missing-middleware
---
You are a Reviewer subagent.
`, 'utf8');

      const taskTool = await createCodaraTaskTool({
        model: new SystemEchoModel() as unknown as BaseChatModel,
        builtinTools: false,
        tools: [
          tool(async () => 'ok', {name: 'read_file', description: 'read', schema: z.object({})}),
        ],
        skills: {
          store: {
            discover: async () => [{
              name: 'custom-agents',
              description: 'shared skills runtime',
              path: path.join(skillDir, 'SKILL.md'),
            }],
            listSources: () => [root],
          },
        },
      });

      const parent = await createCodaraAgent({
        model: new FakeModel([
          new AIMessage({
            content: '',
            tool_calls: [{
              id: 'call_codara_task_bad_middleware',
              name: TASK_TOOL_NAME,
              args: {
                prompt: 'Review the implementation',
                subagent_type: 'Reviewer',
              },
            } as ToolCall],
          }),
          new AIMessage('done'),
        ]) as unknown as BaseChatModel,
        builtinTools: false,
        tools: [taskTool],
        skills: {
          store: {
            discover: async () => [{
              name: 'custom-agents',
              description: 'shared skills runtime',
              path: path.join(skillDir, 'SKILL.md'),
            }],
            listSources: () => [root],
          },
        },
      });

      const result = await parent.invoke('delegate this');
      const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

      expect(result.reason).toBe('complete');
      expect(toolMessage.status).toBe('success');
      expect(String(toolMessage.content)).toContain('Subagent completed.');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
