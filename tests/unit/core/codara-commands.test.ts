import {describe, expect, it} from 'bun:test';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {AIMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgentMemoryCheckpointer, createCodara} from '@core';
import {EchoModel, SystemEchoModel} from './codara-fixtures';

class PauseThenCompleteModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const text = messages.map((message) => String(message.content)).join('\n');
    if (text.includes('approved by command')) {
      return new AIMessage('resumed');
    }

    return new AIMessage({
      content: '',
      tool_calls: [{id: 'call_resume', name: 'bash', args: {command: 'git status'}} as ToolCall],
    });
  }

  bindTools(): this {
    return this;
  }
}

describe('Codara slash commands', () => {
  function readSummaryMessage(messages: BaseMessage[]): BaseMessage | undefined {
    return messages.find((message) => message.getType() === 'ai' && message.text.startsWith('Summary:\n'));
  }

  it('should expose built-in slash command help', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.executeCommand('/help');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('/help [command]');
    expect(result.output).toContain('/resume [approve|reject] [feedback]');
    expect(result.output).toContain('/compact [instructions] | /compact checkpoints [keepLast]');
    expect(result.output).toContain('/reload');
    expect((await codara.listCommands()).map((command) => ({
      name: command.name,
      source: command.source.type,
    }))).toEqual([
      {name: 'help', source: 'builtin'},
      {name: 'resume', source: 'builtin'},
      {name: 'compact', source: 'builtin'},
      {name: 'reload', source: 'builtin'},
    ]);
  });

  it('should reload session sources through slash commands without touching createAgent', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.executeCommand('/reload');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('AGENTS.md');
  });

  it('should compact the current conversation through the session-owned compact path', async () => {
    const codara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      summary: {
        summarize: () => 'manual compact summary',
      },
    });

    await codara.invoke('one');
    await codara.invoke('two');
    await codara.invoke('three');

    const result = await codara.executeCommand('/compact');

    expect(result.ok).toBe(true);
    expect(result.output).toContain('Conversation context compacted');
    expect(readSummaryMessage(result.state?.messages ?? [])?.text).toBe('Summary:\nmanual compact summary');
  });

  it('should pass custom compact instructions into the summary middleware path', async () => {
    let seenInstructions: string | undefined;
    const codara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      summary: {
        summarize: ({instructions}) => {
          seenInstructions = instructions;
          return 'manual compact summary';
        },
      },
    });

    await codara.invoke('one');
    await codara.invoke('two');
    await codara.invoke('three');

    const result = await codara.executeCommand('/compact focus on decisions and pending risks');

    expect(result.ok).toBe(true);
    expect(seenInstructions).toBe('focus on decisions and pending risks');
  });

  it('should compact checkpoint history through the slash command agent surface', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.executeCommand('/compact checkpoints 5');

    expect(result.ok).toBe(true);
    expect(result.output).toContain('latest 5 snapshots');
  });

  it('should return a clear error for unknown slash commands', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.executeCommand('/missing');
    expect(result.ok).toBe(false);
    expect(result.output).toContain('Unknown command');
  });

  it('should resume a paused HIL action through the slash command agent surface', async () => {
    const bashTool = tool(
      async ({command}: {command: string}) => `executed:${command}`,
      {
        name: 'bash',
        description: 'Execute shell command',
        schema: z.object({command: z.string()}),
      },
    );
    const codara = createCodara({
      model: new PauseThenCompleteModel() as unknown as BaseChatModel,
      tools: [bashTool],
      skills: false,
      builtinTools: false,
      hil: {
        interruptOn: {
          bash: true,
        },
      },
    });

    await codara.invoke('run command');
    expect(codara.getAgentState().status).toBe('paused');

    const result = await codara.executeCommand('/resume approve approved by command');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('approved');
    expect(result.state?.status).toBe('idle');
    expect(String(result.state?.messages.at(-1)?.content)).toBe('resumed');
  });

  it('should resume a restored paused session through slash commands even before explicit hydrate', async () => {
    const bashTool = tool(
      async ({command}: {command: string}) => `executed:${command}`,
      {
        name: 'bash',
        description: 'Execute shell command',
        schema: z.object({command: z.string()}),
      },
    );
    const checkpointer = createAgentMemoryCheckpointer();
    const original = createCodara({
      model: new PauseThenCompleteModel() as unknown as BaseChatModel,
      tools: [bashTool],
      checkpointer,
      skills: false,
      builtinTools: false,
      hil: {
        interruptOn: {
          bash: true,
        },
      },
      threadId: 'resume-command-restore-thread',
    });

    await original.invoke('run command');
    expect(original.getAgentState().status).toBe('paused');

    const restored = createCodara({
      model: new PauseThenCompleteModel() as unknown as BaseChatModel,
      tools: [bashTool],
      checkpointer,
      skills: false,
      builtinTools: false,
      hil: {
        interruptOn: {
          bash: true,
        },
      },
      threadId: 'resume-command-restore-thread',
      restore: 'latest',
    });

    const result = await restored.executeCommand('/resume approve approved by command');
    expect(result.ok).toBe(true);
    expect(result.state?.status).toBe('idle');
    expect(String(result.state?.messages.at(-1)?.content)).toBe('resumed');
  });
});
