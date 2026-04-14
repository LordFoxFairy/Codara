import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  AIMessage,
  AIMessageChunk,
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
  type MiddlewareLogRecord,
  type Session,
} from '@/index';

class CodaraFacadeModel {
  readonly invocations: BaseMessage[][] = [];

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    this.invocations.push(messages);

    const text = messages.map((message) => stringifyContent(message.content)).join('\n');
    const hasApprovalPrompt = text.includes('approved and continue');
    if (text.includes('executed:git status')) {
      return new AIMessage('CODARA_STREAM_DONE');
    }

    if (text.includes('"type":"review_pause"') && !hasApprovalPrompt) {
      return new AIMessage('WAITING_FOR_APPROVAL');
    }

    return new AIMessage({
      content: '',
      tool_calls: [{id: 'call_codara_stream', name: 'bash', args: {command: 'git status'}} as ToolCall],
    });
  }

  async *stream(messages: BaseMessage[]): AsyncGenerator<AIMessageChunk> {
    const message = await this.invoke(messages);
    yield new AIMessageChunk({
      content: message.content,
      ...(message.tool_calls ? {tool_calls: message.tool_calls} : {}),
      ...(message.invalid_tool_calls ? {invalid_tool_calls: message.invalid_tool_calls} : {}),
      ...(message.additional_kwargs ? {additional_kwargs: message.additional_kwargs} : {}),
      ...(message.usage_metadata ? {usage_metadata: message.usage_metadata} : {}),
      ...(message.response_metadata ? {response_metadata: message.response_metadata} : {}),
    });
  }

  bindTools(): this {
    return this;
  }
}

describe('Codara agent runtime flow', () => {
  it('should pass handleToolErrors through the Codara facade into the agent runtime', async () => {
    const boomTool = tool(
      async () => {
        throw new Error('tool boom');
      },
      {
        name: 'boom',
        description: 'Always fails',
        schema: z.object({}),
      }
    );
    const model = {
      async invoke(): Promise<AIMessage> {
        return new AIMessage({
          content: '',
          tool_calls: [{id: 'call_boom', name: 'boom', args: {}} as ToolCall],
        });
      },
      bindTools(): unknown {
        return this;
      },
    } as unknown as BaseChatModel;

    const codara = createCodara({
      model,
      tools: [boomTool],
      handleToolErrors: false,
      review: false,
    });

    const result = await codara.invoke('run the failing tool');

    expect(result.reason).toBe('error');
    expect(result.error?.message).toContain('Tool "boom" execution failed');
  });

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
    const runtimeEvents: Array<{kind: string; phase: string; status: string}> = [];
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
      sessionId: 'codara-e2e-session',
      tools: [bashTool],
      checkpointer,
      skills: {
        projectRoot,
        userHome,
        cacheTtlMs: 0,
      },
      review: {
        interruptOn: {
          bash: true,
        },
      },
      logging: {
        enabled: true,
        level: 'debug',
        logger: (record: MiddlewareLogRecord) => {
          logs.push(record);
        },
      },
    });
    codara.subscribeRuntimeEvents((event) => {
      runtimeEvents.push({kind: event.kind, phase: event.phase, status: event.status});
    });

    const customEvents: AgentStreamCustomChunk[] = [];
    for await (const chunk of codara.stream('run git status', {streamMode: 'custom'})) {
      customEvents.push(chunk as AgentStreamCustomChunk);
    }

    expect(codara.getState().sessionStatus).toBe('ready');
    expect(codara.getAgentState().status).toBe('paused');
    expect(codara.getAgentState().pendingReview?.action.toolName).toBe('bash');
    expect(bashInvokeCount).toBe(0);
    const reviewEvents = customEvents.filter((e) => e.type === 'review_event');
    const progressEvents = customEvents.filter((e) => e.type === 'tool_progress');
    expect(reviewEvents).toHaveLength(1);
    expect(reviewEvents[0]?.type).toBe('review_event');
    expect((reviewEvents[0] as any)?.payload.type).toBe('review_pause');
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);

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
        && record.toolMetadata?.toolResultType === 'review_pause'
    );
    expect(pauseLog).toBeDefined();

    const restoredModel = new CodaraFacadeModel();
    const restored = createCodara({
      model: restoredModel as unknown as BaseChatModel,
      sessionId: 'codara-e2e-session',
      restore: 'latest',
      tools: [bashTool],
      checkpointer,
      skills: {
        projectRoot,
        userHome,
        cacheTtlMs: 0,
      },
      review: {
        interruptOn: {
          bash: true,
        },
      },
      logging: {
        enabled: true,
        level: 'debug',
        logger: (record: MiddlewareLogRecord) => {
          logs.push(record);
        },
      },
    });

    expect(restored).toBeDefined();
    expect(restored.getState().sessionStatus).toBe('ready');

    const restoredSession = restored as unknown as Session;
    await restoredSession.hydrate();

    // resumeReviewStream will initialize the agent and restore from checkpoint
    for await (const _chunk of restoredSession.resumeReviewStream(
      {decision: 'approve'},
      {
        input: new HumanMessage('approved and continue'),
        streamMode: 'messages',
      }
    )) {
      void _chunk;
    }

    expect(restored.getState().sessionStatus).toBe('ready');
    expect(restored.getAgentState().status).toBe('idle');
    expect(restored.getAgentState().pendingReview).toBeUndefined();

    const finalLog = logs.find(
      (record) =>
        record.stage === 'afterAgent'
        && record.event === 'stage_end'
        && record.resultReason === 'complete'
    );
    expect(finalLog).toBeDefined();
    expect(runtimeEvents.some((event) => event.kind === 'turn' && event.phase === 'start')).toBe(true);
    expect(runtimeEvents.some((event) => event.kind === 'model' && event.phase === 'start')).toBe(true);
    expect(runtimeEvents.some((event) => event.kind === 'tool' && event.phase === 'start')).toBe(true);
    expect(runtimeEvents.some((event) => event.kind === 'review' && event.status === 'paused')).toBe(true);

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
