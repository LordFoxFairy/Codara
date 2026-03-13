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

    expect(items.map((item) => `${item.role}:${item.content}`)).toEqual([
      'system:ready',
      'warning:careful',
      'user:hello',
      'assistant:world',
      'tool:Echo(text: ping)',
      'tool:pong:ping',
      'user:draft',
      'assistant:streaming',
    ]);
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

    expect(items.map((item) => item.role)).toEqual(['task', 'task']);
    expect(items[0]?.content).toBe('TaskList');
    expect(items[1]?.content).toContain('Tasks:');
    expect(items[1]?.content).toContain('- id: task-1\n  subject: Inspect transcript\n  status: in_progress');
    expect(items[1]?.content).toContain('- id: task-2\n  subject: Report result\n  status: pending');
  });

  test('should format common tool calls with friendly Claude-style summaries', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({
          content: '',
          tool_calls: [
            {id: 'call_bash_1', name: 'bash', args: {command: 'git status'}} as ToolCall,
            {id: 'call_read_1', name: 'read_file', args: {file_path: '/tmp/demo.ts', offset: 10, limit: 20}} as ToolCall,
            {id: 'call_fetch_1', name: 'fetch_url', args: {url: 'https://example.com/docs', method: 'GET'}} as ToolCall,
          ],
        }),
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.role).toBe('tool');
    expect(items[0]?.content).toContain('- Bash(git status)');
    expect(items[0]?.content).toContain('- Read(/tmp/demo.ts:10+20)');
    expect(items[0]?.content).toContain('- Fetch(https://example.com/docs)');
  });

  test('should hide AskUser tool call groups because the HIL panel already renders the interaction', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({
          content: 'Need a little more information before I continue.',
          tool_calls: [
            {id: 'call_ask_1', name: 'AskUser', args: {summary: 'Clarify the brief'}} as ToolCall,
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
          name: 'AskUser',
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

  test('should prefer runtime step events over raw tool transcript blocks when available', () => {
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

    expect(items.map((item) => item.role)).toEqual(['tool', 'task']);
    expect(items[0]?.content).toContain('Delegating task');
    expect(items[1]?.content).toContain('CHILD_DONE');
  });

  test('should surface readable tool results instead of generic done markers for runtime events', () => {
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
        {
          id: 'evt_tool_end',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'tool',
          phase: 'end',
          status: 'done',
          label: 'Tool completed',
          detail: 'executed:git status',
        },
      ],
    });

    expect(items.map((item) => item.content)).toEqual([
      'Running Bash(git status)',
      'executed:git status',
    ]);
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
