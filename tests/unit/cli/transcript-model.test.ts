import {describe, expect, test} from 'bun:test';
import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import {buildTranscriptItems, hasTranscriptContent} from '@/cli/transcript/model';

describe('cli transcript model', () => {
  test('should build transcript items from notices, core messages, and active turn', () => {
    const echoToolCall: ToolCall = {id: 'call_echo_1', name: 'echo', args: {text: 'ping'}};
    const items = buildTranscriptItems({
      notices: [
        {id: 'n1', level: 'system', content: 'ready'},
        {id: 'n2', level: 'warning', content: 'careful'},
      ],
      coreMessages: [
        new HumanMessage('hello'),
        new AIMessage('world'),
        new AIMessage({content: '', tool_calls: [echoToolCall]}),
        new ToolMessage({content: 'pong:ping', tool_call_id: 'call_echo_1'}),
      ],
      activeTurn: {
        id: 'turn-1',
        prompt: 'draft',
        response: 'streaming',
        responseRole: 'assistant',
      },
    });

    // Tool calls from AIMessage are not shown separately — ToolMessage provides the result.
    // During streaming (activeTurn present), runtime events handle tool progress display.
    const roles = items.map((item) => item.role);
    expect(roles).toEqual([
      'system',
      'warning',
      'user',
      'assistant',
      'tool',
      'user',
      'assistant',
    ]);
    expect(items[4]?.toolMeta?.toolName).toBe('echo');
    expect(items[5]?.content).toBe('draft');
    expect(items[6]?.content).toBe('streaming');
  });

  test('should project task tool calls and task list results as task transcript items', () => {
    const taskListCall: ToolCall = {id: 'call_task_list_1', name: 'TaskList', args: {}};
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({content: '', tool_calls: [taskListCall]}),
        new ToolMessage({
          content: [
            'Tasks:',
            '- id: task-1 | subject: Inspect transcript | status: in_progress | description: Verify task rendering | blockedBy: (none) | blocks: task-2',
            '- id: task-2 | subject: Report result | status: pending | description: Summarize changes | blockedBy: task-1 | blocks: (none)',
          ].join('\n'),
          tool_call_id: 'call_task_list_1',
        }),
      ],
    });

    // Only the ToolMessage result is shown (tool calls from AIMessage are not rendered separately)
    expect(items.map((item) => item.role)).toEqual(['task']);
    expect(items[0]?.content).toContain('Tasks:');
    expect(items[0]?.content).toContain('- id: task-1\n  subject: Inspect transcript\n  status: in_progress');
    expect(items[0]?.content).toContain('- id: task-2\n  subject: Report result\n  status: pending');
  });

  test('should render tool results with friendly summaries from ToolMessages', () => {
    // Tool calls from AIMessage are not shown separately; ToolMessages provide the results.
    // ToolMessages with toolMeta get friendly formatting.
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({
          content: '',
          tool_calls: [
            {id: 'call_bash_1', name: 'bash', args: {command: 'git status'}} as ToolCall,
          ],
        }),
        new ToolMessage({content: 'On branch main\nnothing to commit', tool_call_id: 'call_bash_1', name: 'bash'}),
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.role).toBe('tool');
    expect(items[0]?.toolMeta?.toolName).toBe('bash');
    expect(items[0]?.toolMeta?.displayName).toBe('Bash');
    expect(items[0]?.toolMeta?.args).toBe('git status');
  });

  test('should hide AskUser tool call groups because the HIL panel already renders the interaction', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({
          content: 'Need a little more information before I continue.',
          tool_calls: [
            {id: 'call_ask_1', name: 'AskUserQuestion', args: {summary: 'Clarify the brief'}} as ToolCall,
          ],
        }),
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.role).toBe('assistant');
    expect(items[0]?.content).toBe('Need a little more information before I continue.');
  });

  test('should hide AskUser tool results and HIL runtime noise after the interaction completes', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new ToolMessage({
          content: '{"action":"submit","answers":{"language":"Python"}}',
          tool_call_id: 'call_ask_result',
          name: 'AskUserQuestion',
        }),
      ],
      runtimeEvents: [
        {
          id: 'evt_tool_ask_start',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'tool',
          phase: 'start',
          status: 'running',
          label: 'AskUser(summary: Need a language)',
        },
        {
          id: 'evt_hil_done',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'hil',
          phase: 'end',
          status: 'done',
          label: 'Review selection applied',
        },
      ],
    });

    expect(items).toEqual([]);
  });

  test('should prefer runtime step events during streaming (activeTurn present)', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({
          content: '',
          tool_calls: [{id: 'call_task_1', name: 'Task', args: {prompt: 'Inspect child work'}} as ToolCall],
        }),
        new ToolMessage({content: 'Delegated task completed.\nsummary:\nCHILD_DONE', tool_call_id: 'call_task_1'}),
      ],
      activeTurn: {
        id: 'turn-streaming',
        prompt: 'do it',
        response: '',
        responseRole: 'assistant',
      },
      runtimeEvents: [
        {
          id: 'evt_tool_1',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'tool',
          phase: 'start',
          status: 'running',
          label: 'Delegating task',
        },
        {
          id: 'evt_task_1',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'task',
          phase: 'end',
          status: 'done',
          label: 'Delegated task completed',
          detail: 'CHILD_DONE',
        },
      ],
    });

    const roles = items.map((item) => item.role);
    expect(roles).toContain('user');
    expect(roles).toContain('task');
    expect(items.some((item) => item.content.includes('CHILD_DONE'))).toBe(true);
  });

  test('should use core messages after turn completes (no activeTurn)', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({
          content: '',
          tool_calls: [{id: 'call_task_1', name: 'Task', args: {prompt: 'Inspect child work'}} as ToolCall],
        }),
        new ToolMessage({content: 'Delegated task completed.\nsummary:\nCHILD_DONE', tool_call_id: 'call_task_1'}),
      ],
      runtimeEvents: [
        {
          id: 'evt_tool_1',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'tool',
          phase: 'start',
          status: 'running',
          label: 'Delegating task',
        },
      ],
    });

    // After turn completes, ToolMessage provides the definitive result
    expect(items).toHaveLength(1);
    expect(items[0]?.role).toBe('tool');
    expect(items[0]?.content).toContain('Delegated task completed');
  });

  test('should include elapsed time in tool meta when paired start/end events exist', () => {
    const startTime = '2026-03-16T10:00:00.000Z';
    const endTime = '2026-03-16T10:00:00.053Z'; // 53ms later
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [],
      activeTurn: {
        id: 'turn-elapsed',
        prompt: 'run it',
        response: '',
        responseRole: 'assistant',
      },
      runtimeEvents: [
        {
          id: 'evt_bash_start',
          sessionId: 'session-1',
          timestamp: startTime,
          kind: 'tool',
          phase: 'start',
          status: 'running',
          label: 'Bash(ls)',
          detail: 'bash',
        },
        {
          id: 'evt_bash_end',
          sessionId: 'session-1',
          timestamp: endTime,
          kind: 'tool',
          phase: 'end',
          status: 'done',
          label: 'Bash completed',
          detail: 'file1.ts\nfile2.ts',
          parentId: 'evt_bash_start',
        },
      ],
    });

    const toolItem = items.find((i) => i.toolMeta?.toolName === 'bash');
    expect(toolItem?.toolMeta?.elapsed).toBe('53ms');
  });

  test('should format elapsed as seconds for longer tool calls', () => {
    const startTime = '2026-03-16T10:00:00.000Z';
    const endTime = '2026-03-16T10:00:02.500Z'; // 2.5s later
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [],
      activeTurn: {
        id: 'turn-elapsed-s',
        prompt: 'run it',
        response: '',
        responseRole: 'assistant',
      },
      runtimeEvents: [
        {
          id: 'evt_read_start',
          sessionId: 'session-1',
          timestamp: startTime,
          kind: 'tool',
          phase: 'start',
          status: 'running',
          label: 'Read(/tmp/file.ts)',
          detail: 'read',
        },
        {
          id: 'evt_read_end',
          sessionId: 'session-1',
          timestamp: endTime,
          kind: 'tool',
          phase: 'end',
          status: 'done',
          label: 'Read completed',
          detail: 'contents here',
          parentId: 'evt_read_start',
        },
      ],
    });

    const toolItem = items.find((i) => i.toolMeta?.toolName === 'read');
    expect(toolItem?.toolMeta?.elapsed).toBe('2.5s');
  });

  test('should surface runtime events during streaming (activeTurn present)', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [],
      activeTurn: {
        id: 'turn-streaming',
        prompt: 'check status',
        response: '',
        responseRole: 'assistant',
      },
      runtimeEvents: [
        {
          id: 'evt_tool_start',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'tool',
          phase: 'start',
          status: 'running',
          label: 'Running Bash(git status)',
        },
        {
          id: 'evt_tool_end',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'tool',
          phase: 'end',
          status: 'done',
          label: 'Tool completed',
          detail: 'executed:git status',
          parentId: 'evt_tool_start',
        },
      ],
    });

    // activeTurn items + runtime events
    const roles = items.map((item) => item.role);
    expect(roles).toContain('user');
    expect(roles).toContain('tool');
  });

  test('should not render runtime events after turn completes (no activeTurn)', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [],
      runtimeEvents: [
        {
          id: 'evt_tool_start',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'tool',
          phase: 'start',
          status: 'running',
          label: 'Running Bash(git status)',
        },
      ],
    });

    expect(items).toEqual([]);
  });

  test('should treat notice-only output as transcript content after startup', () => {
    expect(hasTranscriptContent({
      coreMessages: [],
      notices: [
        {id: 'startup', level: 'system', content: 'startup'},
        {id: 'result', level: 'system', content: 'slash output'},
      ],
      initialNoticeCount: 1,
    })).toBe(true);
  });

  test('should treat non-empty core system messages as transcript content', () => {
    expect(hasTranscriptContent({
      coreMessages: [new SystemMessage('system note')],
      notices: [{id: 'startup', level: 'system', content: 'startup'}],
      initialNoticeCount: 1,
    })).toBe(true);
  });

  test('should treat tool messages as transcript content', () => {
    expect(hasTranscriptContent({
      coreMessages: [new ToolMessage({content: 'pong:ping', tool_call_id: 'call_tool_1'})],
      notices: [{id: 'startup', level: 'system', content: 'startup'}],
      initialNoticeCount: 1,
    })).toBe(true);
  });

  test('should treat runtime step events as transcript content', () => {
    expect(hasTranscriptContent({
      coreMessages: [],
      notices: [{id: 'startup', level: 'system', content: 'startup'}],
      runtimeEvents: [{
        id: 'evt_runtime_1',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'command',
        phase: 'start',
        status: 'running',
        label: 'Running /reload',
      }],
      initialNoticeCount: 1,
    })).toBe(true);
  });
});
