import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {tool} from '@langchain/core/tools';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {createAgent, loadAgent, restoreAgent} from '@core/agents';
import {createAgentFileCheckpointer, createAgentMemoryCheckpointer} from '@core/checkpoint';
import {createHILMiddleware} from '@core/middleware';

class CountingModel {
  readonly invocations: BaseMessage[][] = [];

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    this.invocations.push(messages);
    const humanCount = messages.filter((message) => HumanMessage.isInstance(message)).length;
    return new AIMessage(`seen_humans:${humanCount}`);
  }

  bindTools(tools: StructuredToolInterface[]): this {
    void tools;
    return this;
  }
}

class ConfirmationModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const text = messages.map((message) => stringifyContent(message.content)).join('\n');

    if (text.includes('executed:git status')) {
      return new AIMessage('CONFIRMED_DONE');
    }

    const hasApprovalPrompt = text.includes('approved and continue');
    const hasPause = text.includes('"type":"hil_pause"');

    if (hasPause && !hasApprovalPrompt) {
      return new AIMessage('WAITING_USER_CONFIRMATION');
    }

    return new AIMessage({
      content: '',
      tool_calls: [{id: 'call_confirm', name: 'bash', args: {command: 'git status'}} as ToolCall],
    });
  }

  bindTools(tools: StructuredToolInterface[]): this {
    void tools;
    return this;
  }
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => JSON.stringify(item)).join('\n');
  }
  return JSON.stringify(content);
}

describe('Agent', () => {
  it('should preserve message state across invokes', async () => {
    const model = new CountingModel();
    const agent = createAgent({model: model as unknown as BaseChatModel});

    const first = await agent.invoke('hello');
    expect(first.reason).toBe('complete');
    expect(String(first.state.messages[first.state.messages.length - 1]?.content)).toBe('seen_humans:1');

    const second = await agent.invoke('world');
    expect(second.reason).toBe('complete');
    expect(String(second.state.messages[second.state.messages.length - 1]?.content)).toBe('seen_humans:2');

    const state = agent.getState();
    expect(state.status).toBe('idle');
    expect(state.messages).toHaveLength(4);
    expect(state.checkpointId).toBeTruthy();
    expect(model.invocations).toHaveLength(2);
  });

  it('should default to memory-backed checkpoints', async () => {
    const model = new CountingModel();
    const agent = createAgent({model: model as unknown as BaseChatModel});

    await agent.invoke('hello');
    const checkpoint = await agent.saveCheckpoint();

    expect(checkpoint.ref.threadId).toBe(agent.getState().threadId);
    expect(checkpoint.info.source).toBe('manual');
    expect(checkpoint.state.messages).toHaveLength(2);

    const restored = restoreAgent({
      model: model as unknown as BaseChatModel,
      checkpoint,
    });

    expect(restored.getState().messages).toHaveLength(2);
    expect(restored.getState().checkpointId).toBe(checkpoint.ref.checkpointId);
  });

  it('should restore paused HIL state from checkpoint and resume through createAgent state', async () => {
    const model = new ConfirmationModel();
    const checkpointer = createAgentMemoryCheckpointer();

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

    const hilMiddleware = createHILMiddleware({
      interruptOn: {bash: true},
      handleResume: async (_request, resumePayload, context, handler) => {
        const payload = resumePayload as {action?: string};
        if (payload.action === 'allow') {
          return handler(context);
        }
        return new ToolMessage({
          content: 'Blocked by user decision',
          tool_call_id: context.toolCall.id ?? 'blocked',
          status: 'error',
        });
      },
    });

    const agent = createAgent({
      model: model as unknown as BaseChatModel,
      tools: [bashTool],
      middlewares: [hilMiddleware],
      threadId: 'thread-memory-hil',
      checkpointer,
    });

    const first = await agent.invoke('run git status');
    expect(first.reason).toBe('complete');
    expect(String(first.state.messages[first.state.messages.length - 1]?.content)).toContain(
      'WAITING_USER_CONFIRMATION'
    );
    expect(bashInvokeCount).toBe(0);

    const pausedState = agent.getState();
    expect(pausedState.status).toBe('paused');
    expect(pausedState.pendingPause?.action.toolName).toBe('bash');

    const restored = await loadAgent({
      model: model as unknown as BaseChatModel,
      tools: [bashTool],
      middlewares: [hilMiddleware],
      checkpointer,
      threadId: pausedState.threadId,
    });

    expect(restored).toBeDefined();
    expect(restored?.getState().status).toBe('paused');

    const second = await restored?.resume(
      {action: 'allow'},
      {
        input: 'approved and continue',
        recursionLimit: 4,
      }
    );

    expect(second?.reason).toBe('complete');
    expect(String(second?.state.messages[second?.state.messages.length - 1]?.content)).toContain('CONFIRMED_DONE');
    expect(restored?.getState().status).toBe('idle');
    expect(restored?.getState().pendingPause).toBeUndefined();
    expect(bashInvokeCount).toBe(1);
  });

  it('should persist and restore checkpoints through file storage', async () => {
    const model = new CountingModel();
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'codara-agent-checkpoint-'));
    const checkpointer = createAgentFileCheckpointer({rootDir});

    const agent = createAgent({
      model: model as unknown as BaseChatModel,
      threadId: 'thread-file-basic',
      checkpointer,
    });

    const first = await agent.invoke('hello');
    expect(first.reason).toBe('complete');
    expect(agent.getState().checkpointId).toBeTruthy();

    const restored = await loadAgent({
      model: model as unknown as BaseChatModel,
      threadId: 'thread-file-basic',
      checkpointer,
    });

    expect(restored).toBeDefined();
    expect(restored?.getState().messages).toHaveLength(2);

    const second = await restored?.invoke('again');
    expect(second?.reason).toBe('complete');
    expect(String(second?.state.messages[second?.state.messages.length - 1]?.content)).toBe('seen_humans:2');
  });

  it('should restore a paused HIL checkpoint from file storage and resume', async () => {
    const model = new ConfirmationModel();
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'codara-agent-hil-checkpoint-'));
    const checkpointer = createAgentFileCheckpointer({rootDir});

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

    const hilMiddleware = createHILMiddleware({
      interruptOn: {bash: true},
      handleResume: async (_request, resumePayload, context, handler) => {
        const payload = resumePayload as {action?: string};
        if (payload.action === 'allow') {
          return handler(context);
        }
        return new ToolMessage({
          content: 'Blocked by user decision',
          tool_call_id: context.toolCall.id ?? 'blocked',
          status: 'error',
        });
      },
    });

    const agent = createAgent({
      model: model as unknown as BaseChatModel,
      tools: [bashTool],
      middlewares: [hilMiddleware],
      threadId: 'thread-file-hil',
      checkpointer,
    });

    const first = await agent.invoke('run git status');
    expect(first.reason).toBe('complete');
    expect(agent.getState().status).toBe('paused');

    const restored = await loadAgent({
      model: model as unknown as BaseChatModel,
      tools: [bashTool],
      middlewares: [hilMiddleware],
      threadId: 'thread-file-hil',
      checkpointer,
    });

    expect(restored?.getState().status).toBe('paused');
    expect(restored?.getState().pendingPause?.action.toolName).toBe('bash');

    const second = await restored?.resume(
      {action: 'allow'},
      {
        input: 'approved and continue',
        recursionLimit: 4,
      }
    );

    expect(second?.reason).toBe('complete');
    expect(String(second?.state.messages[second?.state.messages.length - 1]?.content)).toContain('CONFIRMED_DONE');
    expect(restored?.getState().status).toBe('idle');
    expect(restored?.getState().pendingPause).toBeUndefined();
    expect(bashInvokeCount).toBe(1);
  });

  it('should return undefined when loading a missing thread', async () => {
    const model = new CountingModel();
    const checkpointer = createAgentMemoryCheckpointer();

    const restored = await loadAgent({
      model: model as unknown as BaseChatModel,
      threadId: 'missing-thread',
      checkpointer,
    });

    expect(restored).toBeUndefined();
  });
});
