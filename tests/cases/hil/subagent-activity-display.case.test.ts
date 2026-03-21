import {describe, expect, test, beforeAll, afterAll} from 'bun:test';
import {mkdtemp, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AIMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createCodaraRuntime} from '@/index';
import {createTaskTool} from '@capability/task/middleware';
import type {CodaraRuntimeEvent} from '@observability/events';

/**
 * Pipeline integration test: Sub-agent Activity Display
 *
 * Verifies that when a parent agent delegates a task, child tool activity
 * is forwarded to the parent's runtime events as task:update events.
 */
describe('sub-agent activity display pipeline', () => {
  let cwd: string;

  beforeAll(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), 'codara-activity-'));
    await mkdir(path.join(cwd, '.codara'), {recursive: true});
  });

  afterAll(async () => {
    await rm(cwd, {recursive: true, force: true}).catch(() => {});
  });

  test('child tool activity appears as task:update runtime events', async () => {
    // Child model: calls read_file, then responds
    const childModel = new ChildActivityModel();
    const readTool = tool(
      async ({file_path}: {file_path: string}) => `content of ${file_path}`,
      {
        name: 'read',
        description: 'Read a file',
        schema: z.object({file_path: z.string()}),
      },
    );
    const grepTool = tool(
      async ({pattern}: {pattern: string}) => `matches for ${pattern}`,
      {
        name: 'grep',
        description: 'Search content',
        schema: z.object({pattern: z.string()}),
      },
    );

    // Parent model: delegates a task, then finishes
    const parentModel = new ParentActivityModel();

    const codara = await createCodaraRuntime({
      cwd,
      projectRoot: cwd,
      codaraPath: path.join(cwd, '.codara'),
      model: parentModel as unknown as BaseChatModel,
      builtinTools: false,
      skills: false,
      hil: false,
      tools: [
        createTaskTool({
          model: childModel as unknown as BaseChatModel,
          tools: [readTool, grepTool],
        }),
      ],
    });

    // Collect runtime events
    const events: CodaraRuntimeEvent[] = [];
    codara.subscribeRuntimeEvents(e => events.push(e));

    // Run the parent agent
    await codara.invoke('Run analysis');

    // Find task:update events (child tool activity)
    const taskUpdates = events.filter(e => e.kind === 'task' && e.phase === 'update');

    // Should have at least the child tool activity events
    expect(taskUpdates.length).toBeGreaterThanOrEqual(2);

    // Verify the activity labels contain tool info
    const labels = taskUpdates.map(e => e.label);
    expect(labels.some(l => l.includes('read'))).toBe(true);
    expect(labels.some(l => l.includes('grep'))).toBe(true);

    // Verify parent task lifecycle events exist
    const taskStarts = events.filter(e => e.kind === 'task' && e.phase === 'start');
    const taskEnds = events.filter(e => e.kind === 'task' && e.phase === 'end');
    expect(taskStarts.length).toBeGreaterThanOrEqual(1);
    expect(taskEnds.length).toBeGreaterThanOrEqual(1);

    await codara.dispose();
  });
});

/**
 * Scripted child model: calls read then grep, then finishes.
 */
class ChildActivityModel {
  private index = 0;
  private readonly responses = [
    new AIMessage({
      content: '',
      tool_calls: [
        {id: 'child_read_1', name: 'read', args: {file_path: 'src/engine/agent.ts'}} as ToolCall,
      ],
    }),
    new AIMessage({
      content: '',
      tool_calls: [
        {id: 'child_grep_1', name: 'grep', args: {pattern: 'middleware'}} as ToolCall,
      ],
    }),
    new AIMessage('Analysis complete: found 3 middleware references'),
  ];

  async invoke(_messages: BaseMessage[]): Promise<AIMessage> {
    void _messages;
    const response = this.responses[this.index] ?? new AIMessage('done');
    this.index++;
    return response;
  }

  bindTools(_tools: StructuredToolInterface[]): this {
    void _tools;
    return this;
  }
}

/**
 * Scripted parent model: delegates a task, then finishes.
 */
class ParentActivityModel {
  private index = 0;
  private readonly responses = [
    new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'parent_task_1',
          name: 'Task',
          args: {prompt: 'Analyze the codebase architecture', subagent_type: 'Agent'},
        } as ToolCall,
      ],
    }),
    new AIMessage('Analysis delegated successfully.'),
  ];

  async invoke(_messages: BaseMessage[]): Promise<AIMessage> {
    void _messages;
    const response = this.responses[this.index] ?? new AIMessage('done');
    this.index++;
    return response;
  }

  bindTools(_tools: StructuredToolInterface[]): this {
    void _tools;
    return this;
  }
}
