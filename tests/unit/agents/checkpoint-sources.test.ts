import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agents';
import {createAgentMemoryCheckpointer} from '@core/checkpoint';
import {createConversationContextMiddleware, createHILMiddleware} from '@core/middleware';

class SequenceModel {
  private index = 0;

  constructor(private readonly responses: AIMessage[]) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    void messages;
    const response = this.responses[this.index];
    if (!response) {
      throw new Error(`No fake response at index ${this.index}`);
    }

    this.index += 1;
    return response;
  }

  bindTools(): this {
    return this;
  }
}

describe('agent checkpoint source semantics', () => {
  it('should persist invoke checkpoints with invoke source and run summary info', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const agent = createAgent({
      model: new SequenceModel([new AIMessage('done')]) as unknown as BaseChatModel,
      checkpointer,
      threadId: 'checkpoint-source-invoke',
    });

    const result = await agent.invoke('hello');
    const latest = await checkpointer.getLatest('checkpoint-source-invoke');

    expect(result.reason).toBe('complete');
    expect(latest?.info.source).toBe('invoke');
    expect(latest?.info.status).toBe('idle');
    expect(latest?.info.reason).toBe('complete');
    expect(latest?.info.turns).toBe(1);
  });

  it('should persist resume checkpoints with resume source after a paused tool run continues', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const bashTool = tool(
      async ({command}: {command: string}) => `executed:${command}`,
      {
        name: 'bash',
        description: 'Execute shell command',
        schema: z.object({command: z.string()}),
      }
    );
    class PauseThenCompleteModel {
      async invoke(messages: BaseMessage[]): Promise<AIMessage> {
        const text = messages.map((message) => String(message.content)).join('\n');
        if (text.includes('approved by checkpoint test')) {
          return new AIMessage('resumed');
        }

        return new AIMessage({
          content: '',
          tool_calls: [{id: 'call_resume_source', name: 'bash', args: {command: 'git status'}} as ToolCall],
        });
      }

      bindTools(): this {
        return this;
      }
    }
    const agent = createAgent({
      model: new PauseThenCompleteModel() as unknown as BaseChatModel,
      tools: [bashTool],
      checkpointer,
      threadId: 'checkpoint-source-resume',
      middleware: [
        createHILMiddleware({
          interruptOn: {
            bash: true,
          },
        }),
      ],
    });

    const paused = await agent.invoke('run command');
    expect(paused.state.status).toBe('paused');

    const resumed = await agent.resume(
      {decision: 'approve'},
      {input: new HumanMessage('approved by checkpoint test')}
    );
    const latest = await checkpointer.getLatest('checkpoint-source-resume');

    expect(resumed.reason).toBe('complete');
    expect(latest?.info.source).toBe('resume');
    expect(latest?.info.status).toBe('idle');
    expect(latest?.info.reason).toBe('complete');
  });

  it('should not write a manual checkpoint when compactConversation produces no runtime mutation', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const agent = createAgent({
      model: new SequenceModel([new AIMessage('done')]) as unknown as BaseChatModel,
      checkpointer,
      threadId: 'checkpoint-source-compact-noop',
    });

    await agent.invoke('hello');
    const before = await checkpointer.list('checkpoint-source-compact-noop');

    await agent.compactConversation();

    const after = await checkpointer.list('checkpoint-source-compact-noop');
    expect(after).toHaveLength(before.length);
    expect(after.at(-1)?.ref.checkpointId).toBe(before.at(-1)?.ref.checkpointId);
    expect(after.at(-1)?.info.source).toBe('invoke');
  });

  it('should persist a manual checkpoint only when compactConversation actually rewrites runtime state', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const agent = createAgent({
      model: new SequenceModel([new AIMessage('done')]) as unknown as BaseChatModel,
      checkpointer,
      threadId: 'checkpoint-source-compact-manual',
      middleware: [
        createConversationContextMiddleware({
          summary: {
            maxMessages: 99,
            keepLastMessages: 2,
            summarize: () => 'manual compact summary',
          },
        }),
      ],
    });

    await agent.invoke({
      messages: [
        new HumanMessage('one'),
        new AIMessage('two'),
        new HumanMessage('three'),
        new AIMessage('four'),
        new HumanMessage('five'),
      ],
    });

    const before = await checkpointer.list('checkpoint-source-compact-manual');
    const compacted = await agent.compactConversation();
    const after = await checkpointer.list('checkpoint-source-compact-manual');

    expect(String(compacted.messages[0]?.content)).toContain('# Conversation Summary');
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)?.info.source).toBe('manual');
    expect(after.at(-1)?.info.status).toBe('idle');
    expect(after.at(-1)?.info.reason).toBeUndefined();
    expect(after.at(-1)?.info.turns).toBeUndefined();
  });

  it('should persist reset and dispose checkpoints with their own control sources', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const agent = createAgent({
      model: new SequenceModel([new AIMessage('done')]) as unknown as BaseChatModel,
      checkpointer,
      threadId: 'checkpoint-source-controls',
    });

    await agent.invoke('hello');
    await agent.reset();

    const afterReset = await checkpointer.getLatest('checkpoint-source-controls');
    expect(afterReset?.info.source).toBe('reset');
    expect(afterReset?.info.status).toBe('idle');
    expect(afterReset?.state.messages).toHaveLength(0);

    await agent.dispose();

    const afterDispose = await checkpointer.getLatest('checkpoint-source-controls');
    expect(afterDispose?.info.source).toBe('dispose');
    expect(afterDispose?.info.status).toBe('closed');
  });

  it('should not write a manual checkpoint when compactConversation fails during context validation', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const agent = createAgent({
      model: new SequenceModel([new AIMessage('done')]) as unknown as BaseChatModel,
      checkpointer,
      threadId: 'checkpoint-source-compact-validation-error',
      context: {
        tenantId: 'tenant-1',
      },
      middleware: [
        {
          name: 'compact_context_guard',
          contextSchema: z.object({
            tenantId: z.string(),
            userId: z.string(),
          }),
          beforeModel: () => undefined,
        },
      ],
    });

    await agent.invoke('hello');
    const before = await checkpointer.list('checkpoint-source-compact-validation-error');

    await expect(
      agent.compactConversation()
    ).rejects.toThrow('context validation failed');

    const after = await checkpointer.list('checkpoint-source-compact-validation-error');
    expect(after).toHaveLength(before.length);
    expect(agent.getState().status).toBe('idle');
  });

  it('should roll back running state when compactConversation fails inside middleware preflight', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const agent = createAgent({
      model: new SequenceModel([new AIMessage('done')]) as unknown as BaseChatModel,
      checkpointer,
      threadId: 'checkpoint-source-compact-beforemodel-error',
      middleware: [
        {
          name: 'compact_before_model_fail',
          beforeModel: () => {
            throw new Error('compact beforeModel failed');
          },
        },
      ],
    });

    await agent.invoke('hello');
    const before = await checkpointer.list('checkpoint-source-compact-beforemodel-error');

    await expect(
      agent.compactConversation()
    ).rejects.toThrow('compact beforeModel failed');

    const after = await checkpointer.list('checkpoint-source-compact-beforemodel-error');
    expect(after).toHaveLength(before.length);
    expect(agent.getState().status).toBe('idle');
  });
});
