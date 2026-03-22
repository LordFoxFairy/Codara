import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AIMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agent';
import {createHILMiddleware} from '@core/middleware';
import {createAgentRunMemoryStore, createAgentRuntime, type AgentRunRecord, AGENT_TOOL_NAME, createAgentTool} from '@capability/subagent';
import {FileSystemSkillStore} from '@capability/skill';
import {readAgentRunLaunchResult} from '@shared/agent-run-launch';
import {createAgentSkillsMiddleware, ChildSummaryModel, ScriptedModel} from './task-tool.fixtures';

class GuardedSystemEchoModel {
  private step = 0;

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    if (this.step === 0) {
      this.step += 1;
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'child_guarded_read',
          name: 'read_file',
          args: {path: 'research.md'},
        } as ToolCall],
      });
    }

    const systemText = messages
      .filter((message) => message.type === 'system')
      .map((message) => String(message.content))
      .join('\n---\n');
    return new AIMessage(systemText);
  }

  bindTools(tools: unknown): this {
    void tools;
    return this;
  }
}

async function waitForAgentRunStatus(
  runStore: {get(runId: string): AgentRunRecord | undefined},
  runId: string,
  status: AgentRunRecord['status'],
): Promise<AgentRunRecord> {
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

describe('createAgentTool definitions', () => {
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
              name: AGENT_TOOL_NAME,
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
          createAgentTool({
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
              name: AGENT_TOOL_NAME,
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
          createAgentTool({
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

  it('应在 delegated child resume 时保留原始 subagent_type profile', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-task-tool-resume-profile-'));

    try {
      const runStore = createAgentRunMemoryStore();
      const taskRuntime = createAgentRuntime({runStore});
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

      const childModel = new GuardedSystemEchoModel();
      const parent = createAgent({
        model: new ScriptedModel([
          new AIMessage({
            content: '',
            tool_calls: [{
              id: 'call_task_resume_profile',
              name: AGENT_TOOL_NAME,
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
          createAgentTool({
            model: childModel as unknown as BaseChatModel,
            tools: [
              tool(async () => 'ok', {name: 'read_file', description: 'read', schema: z.object({path: z.string()})}),
              tool(async () => 'ok', {name: 'grep', description: 'grep', schema: z.object({})}),
            ],
            childMiddleware: [createHILMiddleware({interruptOn: {read_file: true}})],
            runStore,
            runtime: taskRuntime,
          }),
        ],
      });

      const launched = await parent.invoke('delegate this');
      const toolMessage = launched.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;
      const launch = readAgentRunLaunchResult(toolMessage.artifact);

      expect(launched.reason).toBe('complete');
      expect(launched.state.status).toBe('idle');
      expect(launched.state.pendingPause).toBeUndefined();
      expect(launch).toMatchObject({
        type: 'agent_run_started',
        runId: 'call_task_resume_profile',
      });

      const paused = await waitForAgentRunStatus(runStore, 'call_task_resume_profile', 'paused');
      expect(paused.latestActivity).toContain('Tool: read_file');
      expect(paused.toolUseCount).toBe(1);

      await taskRuntime.resumeRun('call_task_resume_profile', {decision: 'approve'});
      const completed = await waitForAgentRunStatus(runStore, 'call_task_resume_profile', 'completed');

      expect(completed.summary).toContain('You are a Researcher subagent.');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
