import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
  type ToolCall,
} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {
  createAgentFileCheckpointer,
  createCodara,
  type AgentStreamCustomChunk,
  type AgentStreamMessagesChunk,
  type MiddlewareLogRecord,
} from '@core';

class CodaraFacadeModel {
  readonly invocations: BaseMessage[][] = [];

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    this.invocations.push(messages);

    const text = messages.map((message) => stringifyContent(message.content)).join('\n');
    const hasApprovalPrompt = text.includes('approved and continue');
    if (text.includes('executed:git status')) {
      return new AIMessage('CODARA_STREAM_DONE');
    }

    if (text.includes('"type":"hil_pause"') && !hasApprovalPrompt) {
      return new AIMessage('WAITING_FOR_APPROVAL');
    }

    return new AIMessage({
      content: '',
      tool_calls: [{id: 'call_codara_stream', name: 'bash', args: {command: 'git status'}} as ToolCall],
    });
  }

  bindTools(): this {
    return this;
  }
}

describe('Codara agent runtime flow', () => {
  it('should stream, checkpoint, reload, and resume through the top-level Codara facade', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-core-stream-'));
    const projectRoot = path.join(root, 'project');
    const userHome = path.join(root, 'home');
    const skillDir = path.join(projectRoot, '.codara', 'skills', 'terminal-helper');
    const checkpointRoot = path.join(root, 'state', 'threads');

    await mkdir(skillDir, {recursive: true});
    await mkdir(path.join(userHome, '.codara', 'skills'), {recursive: true});
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: terminal-helper
description: Helps terminal sessions coordinate approvals.
allowed-tools:
  - bash
---

# Terminal Helper
`
    );

    const logs: MiddlewareLogRecord[] = [];
    let bashInvokeCount = 0;
    const bashTool = tool(
      async ({command}: {command: string}) => {
        bashInvokeCount += 1;
        return `executed:${command}`;
      },
      {
        name: 'bash',
        description: 'Execute shell command',
        schema: z.object({command: z.string()}),
      }
    );
    const checkpointer = createAgentFileCheckpointer({rootDir: checkpointRoot});

    const firstModel = new CodaraFacadeModel();
    const codara = createCodara({
      model: firstModel as unknown as BaseChatModel,
      tools: [bashTool],
      checkpointer,
      skills: {
        projectRoot,
        userHome,
        cacheTtlMs: 0,
      },
      hil: {
        interruptOn: {
          bash: true,
        },
      },
      logging: {
        enabled: true,
        level: 'debug',
        logger: (record) => {
          logs.push(record);
        },
      },
    });
    const agent = await codara.createSession({
      threadId: 'codara-e2e-thread',
    });

    const customEvents: AgentStreamCustomChunk[] = [];
    for await (const chunk of agent.stream('run git status', {streamMode: 'custom'})) {
      customEvents.push(chunk as AgentStreamCustomChunk);
    }

    expect(agent.getState().status).toBe('paused');
    expect(agent.getState().pendingPause?.action.toolName).toBe('bash');
    expect(bashInvokeCount).toBe(0);
    expect(customEvents).toHaveLength(1);
    expect(customEvents[0]?.type).toBe('hil_event');
    expect(customEvents[0]?.payload.type).toBe('hil_pause');

    const sawSkillPrompt = firstModel.invocations.some((messages) =>
      messages.some(
        (message) =>
          message instanceof SystemMessage
          && String(message.content).includes('terminal-helper')
      )
    );
    expect(sawSkillPrompt).toBe(true);

    const pauseLog = logs.find(
      (record) =>
        record.stage === 'wrapToolCall'
        && record.event === 'stage_end'
        && record.toolMetadata?.toolResultType === 'hil_pause'
    );
    expect(pauseLog).toBeDefined();

    const restoredModel = new CodaraFacadeModel();
    const restored = await codara.loadSession({
      model: restoredModel as unknown as BaseChatModel,
      tools: [bashTool],
      threadId: 'codara-e2e-thread',
      skills: {
        projectRoot,
        userHome,
        cacheTtlMs: 0,
      },
      hil: {
        interruptOn: {
          bash: true,
        },
      },
      logging: {
        enabled: true,
        level: 'debug',
        logger: (record) => {
          logs.push(record);
        },
      },
    });

    expect(restored).toBeDefined();
    expect(restored?.getState().status).toBe('paused');

    const streamedText: string[] = [];
    for await (const chunk of restored!.resumeStream(
      {decision: 'approve'},
      {
        input: new HumanMessage('approved and continue'),
        streamMode: 'messages',
      }
    )) {
      const [messageChunk] = chunk as AgentStreamMessagesChunk;
      streamedText.push(String(messageChunk.content));
    }

    expect(streamedText.join('')).toBe('CODARA_STREAM_DONE');
    expect(restored?.getState().status).toBe('idle');
    expect(restored?.getState().pendingPause).toBeUndefined();
    expect(bashInvokeCount).toBe(1);

    const finalLog = logs.find(
      (record) =>
        record.stage === 'afterAgent'
        && record.event === 'stage_end'
        && record.resultReason === 'complete'
    );
    expect(finalLog).toBeDefined();

    const restoredSkillPrompt = restoredModel.invocations.some((messages) =>
      messages.some(
        (message) =>
          message instanceof SystemMessage
          && String(message.content).includes('terminal-helper')
      )
    );
    expect(restoredSkillPrompt).toBe(true);
  });
});

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => JSON.stringify(item)).join('\n');
  }
  return JSON.stringify(content);
}
