import {describe, expect, it} from 'bun:test';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {
  DEFAULT_SUBAGENT_TOOL_NAME,
  TASK_TOOL_NAME,
} from '@core';
import {createCodaraSubagentMiddleware, createCodaraTaskMiddleware} from '@core/codara';
import {SystemEchoModel} from './codara-fixtures';

describe('Codara tasking middleware wrappers', () => {
  it('should wrap the delegated Task tool inside a middleware', async () => {
    const middleware = await createCodaraTaskMiddleware({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      builtinTools: false,
      tools: [
        tool(async () => 'ok', {name: 'read_file', description: 'read', schema: z.object({})}),
      ],
      skills: false,
    });

    expect(middleware.name).toBe('TaskMiddleware');
    expect(middleware.tools?.map((tool) => tool.name)).toEqual([TASK_TOOL_NAME]);
  });

  it('should wrap the primitive subagent tool inside a middleware', async () => {
    const middleware = await createCodaraSubagentMiddleware({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      builtinTools: false,
      tools: [
        tool(async () => 'ok', {name: 'read_file', description: 'read', schema: z.object({})}),
      ],
      skills: false,
    });

    expect(middleware.name).toBe('SubagentMiddleware');
    expect(middleware.tools?.map((tool) => tool.name)).toEqual([DEFAULT_SUBAGENT_TOOL_NAME]);
  });
});
