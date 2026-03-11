import {describe, expect, it} from 'bun:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AIMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {
  createAgentMemoryCheckpointer,
  createCodara,
  FileSessionStore,
  openCodaraSession,
} from '@core';

class UsageModel {
  async invoke(): Promise<AIMessage> {
    return new AIMessage({
      content: 'done',
      usage_metadata: {
        input_tokens: 120,
        output_tokens: 30,
        total_tokens: 150,
      },
    });
  }

  bindTools(): this {
    return this;
  }
}

class ToolLoopUsageModel {
  private index = 0;

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    void messages;
    const responses = [
      new AIMessage({
        content: '',
        tool_calls: [{id: 'call_telemetry', name: 'echo', args: {text: 'ping'}} as ToolCall],
        usage_metadata: {
          input_tokens: 60,
          output_tokens: 10,
          total_tokens: 70,
        },
      }),
      new AIMessage({
        content: 'done',
        usage_metadata: {
          input_tokens: 90,
          output_tokens: 20,
          total_tokens: 110,
        },
      }),
    ];

    const response = responses[this.index];
    if (!response) {
      throw new Error(`No response configured for index ${this.index}`);
    }

    this.index += 1;
    return response;
  }

  bindTools(): this {
    return this;
  }
}

describe('Codara session telemetry', () => {
  it('should persist usage totals and current context window telemetry on the session', async () => {
    const codara = createCodara({
      model: new UsageModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      inputBudget: {
        maxInputTokens: 200,
        reservedTokens: 50,
      },
    });

    await codara.invoke('hello telemetry');

    const metadata = codara.getState().metadata;
    expect(metadata?.usage).toEqual({
      modelCalls: 1,
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      lastPromptTokens: 120,
      lastCompletionTokens: 30,
      lastTotalTokens: 150,
    });
    expect(metadata?.contextWindow?.maxInputTokens).toBe(200);
    expect(metadata?.contextWindow?.availableInputTokens).toBe(150);
    expect(metadata?.contextWindow?.estimatedInputTokens).toBeGreaterThan(0);
    expect(metadata?.contextWindow?.usagePercent).toBeGreaterThan(0);
    expect(typeof metadata?.contextWindow?.overBudget).toBe('boolean');
  });

  it('should preserve telemetry metadata when reopening an existing stored session', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const store = new FileSessionStore({
      basePath: await mkdtemp(path.join(tmpdir(), 'codara-session-telemetry-')),
    });

    const original = createCodara({
      model: new UsageModel() as unknown as BaseChatModel,
      sessionId: 'telemetry-session',
      threadId: 'telemetry-thread',
      store,
      checkpointer,
      skills: false,
      builtinTools: false,
      inputBudget: {
        maxInputTokens: 200,
        reservedTokens: 50,
      },
    });

    await original.invoke('hello telemetry');

    const restored = await openCodaraSession({
      sessionId: 'telemetry-session',
      store,
      model: new UsageModel() as unknown as BaseChatModel,
      checkpointer,
      skills: false,
      builtinTools: false,
      inputBudget: {
        maxInputTokens: 200,
        reservedTokens: 50,
      },
    });

    const metadata = restored.getState().metadata;
    expect(metadata?.usage?.totalTokens).toBe(150);
    expect(metadata?.usage?.modelCalls).toBe(1);
    expect(metadata?.contextWindow?.maxInputTokens).toBe(200);
    expect(metadata?.contextWindow?.availableInputTokens).toBe(150);
  });

  it('should aggregate usage across all model calls produced by a single agent run', async () => {
    const echoTool = tool(
      async ({text}: {text: string}) => text,
      {
        name: 'echo',
        description: 'Echo telemetry payload',
        schema: z.object({text: z.string()}),
      },
    );

    const codara = createCodara({
      model: new ToolLoopUsageModel() as unknown as BaseChatModel,
      tools: [echoTool],
      skills: false,
      builtinTools: false,
      inputBudget: {
        maxInputTokens: 200,
        reservedTokens: 50,
      },
    });

    await codara.invoke('run telemetry loop');

    expect(codara.getState().metadata?.usage).toEqual({
      modelCalls: 2,
      promptTokens: 150,
      completionTokens: 30,
      totalTokens: 180,
      lastPromptTokens: 90,
      lastCompletionTokens: 20,
      lastTotalTokens: 110,
    });
  });

  it('should clear state-derived metadata after reset while preserving cumulative usage totals', async () => {
    const codara = createCodara({
      model: new UsageModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      inputBudget: {
        maxInputTokens: 200,
        reservedTokens: 50,
      },
    });

    await codara.invoke('hello telemetry');
    await codara.reset();

    const metadata = codara.getState().metadata;
    expect(metadata?.messageCount).toBe(0);
    expect(metadata?.lastMessage).toBeUndefined();
    expect(metadata?.contextWindow).toBeUndefined();
    expect(metadata?.usage?.totalTokens).toBe(150);
    expect(metadata?.usage?.modelCalls).toBe(1);
  });
});
