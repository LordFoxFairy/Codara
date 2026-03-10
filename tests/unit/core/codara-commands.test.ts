import {describe, expect, it} from 'bun:test';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {AIMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createCodara} from '@core';
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
  it('should expose built-in slash command help', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.executeCommand('/help');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('/help [command]');
    expect(result.output).toContain('/memory [show|project|global]');
    expect(result.output).toContain('/resume [approve|reject] [feedback]');
    expect(result.output).toContain('/compact [checkpoints] [keepLast]');
    expect(result.output).toContain('/reload');
    expect(codara.listCommands().map((command) => command.name)).toEqual(['help', 'memory', 'resume', 'compact', 'reload']);
  });

  it('should reload host sources through slash commands without touching createAgent', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.executeCommand('/reload');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('AGENTS.md');
  });

  it('should compact the current conversation through the slash command host surface', async () => {
    const codara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      summary: {
        maxMessages: 99,
        keepLastMessages: 2,
        summarize: () => 'manual compact summary',
      },
    });

    await codara.invoke('one');
    await codara.invoke('two');
    await codara.invoke('three');

    const result = await codara.executeCommand('/compact');

    expect(result.ok).toBe(true);
    expect(result.output).toContain('Conversation compacted');
    expect(String(result.state?.messages[0]?.content)).toContain('# Conversation Summary');
    expect(result.state?.messages.some((message) => message instanceof AIMessage)).toBe(true);
  });

  it('should compact checkpoint history through the slash command host surface', async () => {
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

  it('should resume a paused HIL action through the slash command host surface', async () => {
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
});
