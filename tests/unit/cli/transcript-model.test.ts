import {describe, expect, test} from 'bun:test';
import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import {
  buildActiveItems,
  buildSolidifiedItemsFromRange,
  buildTranscriptItems,
  createToolCallLookup,
  hasTranscriptContent,
  normalizeVisibleAssistantText,
} from '@/cli/transcript/model';
import {createInternalSharedTaskCoordinationMessage} from '@/shared/task-coordination-result';

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

    // Tool calls from AIMessage are not shown separately; ToolMessage provides the result.
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
    expect(items.map((item) => item.role)).toEqual(['tool']);
    expect(items[0]?.content).toContain('Tasks:');
    expect(items[0]?.content).toContain('- id: task-1 | subject: Inspect transcript | status: in_progress');
    expect(items[0]?.content).toContain('- id: task-2 | subject: Report result | status: pending');
  });

  test('should suppress shared task coordination tool output when it is marked internal to a team workspace', () => {
    const taskListCall: ToolCall = {id: 'call_task_list_2', name: 'TaskList', args: {}};
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({content: '', tool_calls: [taskListCall]}),
        createInternalSharedTaskCoordinationMessage([
          'Tasks:',
          '- id: task-1 | subject: Inspect transcript | status: in_progress | description: Verify task rendering | blockedBy: (none) | blocks: task-2',
        ].join('\n'), 'call_task_list_2'),
      ],
    });

    expect(items).toHaveLength(0);
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

  test('should hide write_todos bookkeeping from the main transcript', () => {
    const now = new Date().toISOString();
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({
          content: '',
          tool_calls: [
            {id: 'call_write_todos_1', name: 'write_todos', args: {todos: []}} as ToolCall,
          ],
        }),
        new ToolMessage({
          content: 'Updated todo list to [{"content":"等待 worker 完成","status":"in_progress"}]',
          tool_call_id: 'call_write_todos_1',
          name: 'write_todos',
        }),
      ],
      activeTurn: {
        id: 'turn-write-todos',
        prompt: 'coordinate the team',
        response: '',
        responseRole: 'assistant',
      },
      runtimeEvents: [
        {
          id: 'evt_write_todos_start',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'tool',
          phase: 'start',
          status: 'running',
          label: 'Write Todos(...)',
          detail: 'write_todos',
        },
        {
          id: 'evt_write_todos_end',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'tool',
          phase: 'end',
          status: 'done',
          label: 'Write Todos',
          detail: 'Updated todo list to [{"content":"等待 worker 完成","status":"in_progress"}]',
          parentId: 'evt_write_todos_start',
        },
      ],
    });

    expect(items.map((item) => item.role)).toEqual(['user']);
    expect(items.some((item) => item.content.includes('Updated todo list'))).toBe(false);
  });

  test('should prefer runtime task blocks during streaming without surfacing child summaries', () => {
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
    expect(items.some((item) => item.content.includes('CHILD_DONE'))).toBe(false);
  });

  test('should keep assistant text visible while a delegated task runtime block is active if it was already shown', () => {
    const now = new Date().toISOString();
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [],
      activeTurn: {
        id: 'turn-task-launch-chatter',
        prompt: 'delegate it',
        response: [
          'Task started.',
          'I used the Task tool to launch an Explore subagent for the Codara analysis.',
          'Delegation details:',
          '  - Subagent type: Explore',
          'Waiting for the subagent to complete the analysis...',
        ].join('\n'),
        responseRole: 'assistant',
      },
      runtimeEvents: [
        {
          id: 'task-run:run-2',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'task',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: Analyze project',
        },
      ],
    });

    expect(items.map((item) => item.role)).toEqual(['user', 'assistant', 'task']);
    expect(items.some((item) => item.role === 'assistant')).toBe(true);
  });

  test('should suppress active launch chatter when the streaming response already contains a Task tool call', () => {
    const items = buildActiveItems({
      activeTurn: {
        id: 'turn-task-launch-stream',
        prompt: 'delegate it',
        response: [
          'Task started.',
          'I used the Task tool to launch an Explore subagent.',
          'Delegated task started.',
        ].join('\n'),
        responseRole: 'assistant',
        pendingTaskLaunch: true,
        suppressTaskLaunchResponse: true,
      },
      runtimeEvents: [],
    });

    expect(items.map((item) => item.role)).toEqual(['user']);
    expect(items.some((item) => item.role === 'assistant')).toBe(false);
  });

  test('should suppress active task-completion progress text once that continuation has already launched another Task', () => {
    const items = buildActiveItems({
      activeTurn: {
        id: 'turn-task-completion-launch',
        prompt: '',
        response: 'Waiting for the first batch to finish before I start the next phase.',
        responseRole: 'assistant',
        kind: 'task_completion',
        pendingTaskLaunch: true,
        suppressTaskLaunchResponse: true,
      },
      runtimeEvents: [
        {
          id: 'task-run:run-next-phase',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'task',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: Analyze CLI rendering',
        },
      ],
    });

    expect(items.some((item) => item.role === 'assistant')).toBe(false);
    expect(items.some((item) => item.role === 'task')).toBe(true);
  });

  test('should keep already-visible assistant text even after a Task tool call and runtime task block appear', () => {
    const items = buildActiveItems({
      activeTurn: {
        id: 'turn-visible-before-task-launch',
        prompt: 'delegate it',
        response: 'Let me frame the analysis scope first, then I will proceed.',
        responseRole: 'assistant',
        pendingTaskLaunch: true,
        suppressTaskLaunchResponse: false,
      },
      runtimeEvents: [
        {
          id: 'task-run:run-visible',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'task',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: Analyze project',
        },
      ],
    });

    expect(items.map((item) => item.role)).toEqual(['user', 'assistant', 'task']);
    expect(items.some((item) => item.content.includes('frame the analysis scope first'))).toBe(true);
  });

  test('should suppress solidified assistant launch chatter that only repeats a delegated task launch', () => {
    const taskCall: ToolCall = {
      id: 'call_task_launch_noise',
      name: 'Task',
      args: {prompt: 'Analyze the repo', subagent_type: 'Explore'},
    };
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({content: '', tool_calls: [taskCall]}),
        new ToolMessage({
          content: [
            'Delegated task started in background.',
            'Do not restate launch metadata or promise follow-up.',
            'Wait for runtime updates, review requests, or the delegated result.',
          ].join('\n'),
          tool_call_id: 'call_task_launch_noise',
          name: 'Task',
          artifact: {
            type: 'task_run_started',
            runId: 'call_task_launch_noise',
            sessionId: 'session:task:call_task_launch_noise',
            agentName: 'Explore',
            label: 'Delegating Explore: Analyze the repo',
          },
        }),
        new AIMessage([
          'Task started.',
          'I used the Task tool to launch an Explore subagent.',
          'Delegated task started.',
          'Waiting for the subagent to complete the analysis...',
        ].join('\n')),
      ],
    });

    expect(items).toEqual([]);
  });

  test('should suppress solidified launch chatter on an AI message that also contains a Task tool call', () => {
    const taskCall: ToolCall = {
      id: 'call_task_launch_inline',
      name: 'Task',
      args: {prompt: 'Analyze the repo', subagent_type: 'Explore'},
    };
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new HumanMessage('delegate it'),
        new AIMessage({
          content: [
            'Task started.',
            'I used the Task tool to launch an Explore subagent.',
            'Delegated task started.',
            'Waiting for the subagent to complete the analysis...',
          ].join('\n'),
          tool_calls: [taskCall],
        }),
      ],
    });

    expect(items).toEqual([{
      id: 'human-0',
      role: 'user',
      content: 'delegate it',
    }]);
  });

  test('should suppress a superseded invalid task closeout once a corrected main-agent summary follows', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new HumanMessage('analyze the project'),
        new AIMessage('Phase 1 has started. Waiting for subagent results.'),
        new AIMessage('Codara is a terminal-first AI agent runtime with a layered execution model.'),
      ],
    });

    expect(items.map((item) => ({role: item.role, content: item.content}))).toEqual([
      {role: 'user', content: 'analyze the project'},
      {role: 'assistant', content: 'Codara is a terminal-first AI agent runtime with a layered execution model.'},
    ]);
  });

  test('should preserve a previously visible launch message when it later enters the solidified transcript', () => {
    const taskCall: ToolCall = {
      id: 'call_task_preserved',
      name: 'Task',
      args: {prompt: 'Analyze the repo', subagent_type: 'Explore'},
    };
    const messages = [
      new HumanMessage('delegate it'),
      new AIMessage({
        content: 'Let me frame the analysis scope first, then I will start the delegation.',
        tool_calls: [taskCall],
      }),
    ];
    const toolLookup = createToolCallLookup(messages);

    const items = buildSolidifiedItemsFromRange(
      messages,
      0,
      messages.length,
      toolLookup,
      new Set([normalizeVisibleAssistantText('Let me frame the analysis scope first, then I will start the delegation.')]),
    );

    expect(items.map((item) => ({role: item.role, content: item.content}))).toEqual([
      {role: 'user', content: 'delegate it'},
      {role: 'assistant', content: 'Let me frame the analysis scope first, then I will start the delegation.'},
    ]);
  });

  test('should render completed task tool results as compact execution summaries instead of raw child output', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_task_1',
            name: 'Task',
            args: {prompt: 'Inspect child work', subagent_type: 'Explore'},
          } as ToolCall],
        }),
        new ToolMessage({
          content: 'Delegated task completed.\nsummary:\nCHILD_DONE',
          tool_call_id: 'call_task_1',
          artifact: {
            type: 'delegated_agent_result',
            sessionId: 'session:task:call_task_1',
            turns: 4,
            reason: 'complete',
            summary: 'CHILD_DONE',
            toolUseCount: 3,
            totalTokens: 14400,
          },
        }),
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

    expect(items).toHaveLength(1);
    expect(items[0]?.role).toBe('task');
    expect(items[0]?.content).toContain('Explore(Inspect child work)');
    expect(items[0]?.content).toContain('Done');
    expect(items[0]?.content).toContain('3 tool uses');
    expect(items[0]?.content).toContain('14.4k tokens');
    expect(items[0]?.content).not.toContain('CHILD_DONE');
    expect(items[0]?.toolMeta?.summaryLine).toContain('Done');
    expect(items[0]?.toolMeta?.summaryLine).toContain('3 tool uses');
    expect(items[0]?.toolMeta?.summaryLine).toContain('14.4k tokens');
  });

  test('should suppress synthetic task launch blocks when a runtime task root for the same delegation exists', () => {
    const now = new Date().toISOString();
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [],
      activeTurn: {
        id: 'turn-dedupe-task',
        prompt: 'analyze it',
        response: '',
        responseRole: 'assistant',
      },
      runtimeEvents: [
        {
          id: 'tool-root-1',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'tool',
          phase: 'start',
          status: 'running',
          label: 'Delegating task(prompt: Analyze project)',
          detail: 'Task',
        },
        {
          id: 'synthetic-task-root-1',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'task',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: Analyze project',
          parentId: 'tool-root-1',
        },
        {
          id: 'task-run:run-1',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'task',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: Analyze project',
        },
        {
          id: 'tool-end-1',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'tool',
          phase: 'end',
          status: 'done',
          label: 'Tool completed',
          detail: 'run_id: run-1\ndelegate_id: session-1:task:run-1',
          parentId: 'tool-root-1',
        },
        {
          id: 'synthetic-task-end-1',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'task',
          phase: 'end',
          status: 'done',
          label: 'Delegated task running in background',
          detail: 'run_id: run-1\ndelegate_id: session-1:task:run-1',
          parentId: 'synthetic-task-root-1',
        },
        {
          id: 'runtime-task-update-1',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'task',
          phase: 'update',
          status: 'paused',
          label: 'Delegated task waiting for review',
          detail: 'Need confirmation',
          parentId: 'task-run:run-1',
        },
      ],
    });

    const exploreItems = items.filter((item) => item.role === 'task');
    expect(exploreItems).toHaveLength(1);
    expect(exploreItems[0]?.content).toContain('Waiting for review');
    expect(exploreItems[0]?.content).not.toContain('Done (0s)');
  });

  test('should hide bookkeeping task runtime events like Task started and background-launch status lines', () => {
    const now = new Date().toISOString();
    const items = buildActiveItems({
      activeTurn: {
        id: 'turn-task-bookkeeping',
        prompt: 'delegate it',
        response: '',
        responseRole: 'assistant',
      },
      runtimeEvents: [
        {
          id: 'pending-call-1',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'task',
          phase: 'end',
          status: 'done',
          label: 'Task started',
          parentId: 'pending-call-1',
        },
        {
          id: 'evt-task-launch-finished',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'task',
          phase: 'end',
          status: 'done',
          label: 'Delegated task running in background',
          detail: 'Delegated task started in background.',
          parentId: 'tool-call-1',
        },
      ],
    });

    expect(items.some((item) => item.content.includes('Task started'))).toBe(false);
    expect(items.some((item) => item.content.includes('Delegated task running in background'))).toBe(false);
    expect(items.some((item) => item.content.includes('Delegated task started in background.'))).toBe(false);
  });

  test('should ignore pre-registered pending task placeholders once real parallel task roots exist', () => {
    const now = '2026-03-20T10:00:00.000Z';
    const later = '2026-03-20T10:01:08.000Z';
    const techLabel = 'Delegating Explore: Analyze the tech stack';
    const structureLabel = 'Delegating Explore: Analyze the project structure';
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [],
      activeTurn: {
        id: 'turn-parallel-pending-dedupe',
        prompt: 'delegate two tasks',
        response: '',
        responseRole: 'assistant',
      },
      runtimeEvents: [
        {
          id: 'turn-root',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'turn',
          phase: 'start',
          status: 'running',
          label: 'turn',
        },
        {
          id: 'pending-task-tech',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'task',
          phase: 'start',
          status: 'running',
          label: techLabel,
          detail: 'pending',
          parentId: 'turn-root',
        },
        {
          id: 'pending-task-tech-end',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'task',
          phase: 'end',
          status: 'done',
          label: 'Task started',
          parentId: 'pending-task-tech',
        },
        {
          id: 'task-run:run-tech',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'task',
          phase: 'start',
          status: 'running',
          label: techLabel,
        },
        {
          id: 'runtime-task-tech-end',
          sessionId: 'session-1',
          timestamp: later,
          kind: 'task',
          phase: 'end',
          status: 'done',
          label: 'Delegated task completed',
          detail: 'tech summary',
          parentId: 'task-run:run-tech',
        },
        {
          id: 'task-run:run-structure',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'task',
          phase: 'start',
          status: 'running',
          label: structureLabel,
        },
      ],
    });

    const exploreItems = items.filter((item) => item.role === 'task');
    expect(exploreItems).toHaveLength(2);
    const techItems = exploreItems.filter((item) => item.toolMeta?.status === 'done');
    expect(techItems).toHaveLength(1);
    expect(techItems[0]?.content).not.toContain('Done (0s)');
  });

  test('should render running tasks as aggregate execution summaries without child activity lines', () => {
    const start = '2026-03-20T10:00:00.000Z';
    const update = '2026-03-20T10:00:05.000Z';
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [],
      activeTurn: {
        id: 'turn-running-task',
        prompt: 'analyze it',
        response: '',
        responseRole: 'assistant',
      },
      runtimeEvents: [
        {
          id: 'task-run:evt-task-start',
          sessionId: 'session-1',
          timestamp: start,
          kind: 'task',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: Analyze the repo',
        },
        {
          id: 'evt_task_a',
          sessionId: 'session-1',
          timestamp: update,
          kind: 'task',
          phase: 'update',
          status: 'running',
          label: 'glob(README*)',
          detail: 'glob',
          parentId: 'task-run:evt-task-start',
        },
        {
          id: 'evt_task_b',
          sessionId: 'session-1',
          timestamp: update,
          kind: 'task',
          phase: 'update',
          status: 'running',
          label: 'Read(package.json)',
          detail: 'read',
          parentId: 'task-run:evt-task-start',
        },
        {
          id: 'evt_task_c',
          sessionId: 'session-1',
          timestamp: update,
          kind: 'task',
          phase: 'update',
          status: 'running',
          label: 'Read(src/index.ts)',
          detail: 'read',
          parentId: 'task-run:evt-task-start',
        },
        {
          id: 'evt_task_d',
          sessionId: 'session-1',
          timestamp: update,
          kind: 'task',
          phase: 'update',
          status: 'running',
          label: 'Read(src/core/agent.ts)',
          detail: 'read',
          parentId: 'task-run:evt-task-start',
        },
      ],
    });

    const runningTask = items.find((item) => item.role === 'task');
    expect(runningTask?.toolMeta?.status).toBe('running');
    expect(runningTask?.toolMeta?.summaryLine).toContain('Running');
    expect(runningTask?.toolMeta?.summaryLine).toContain('4 tool activities');
    expect(runningTask?.toolMeta?.outputLines).toBeUndefined();
    expect(runningTask?.toolMeta?.allOutputLines).toBeUndefined();
    expect(runningTask?.toolMeta?.totalOutputLines).toBeUndefined();
  });

  test('should render completed tasks without child activity lines or child summary bodies', () => {
    const start = '2026-03-20T10:00:00.000Z';
    const end = '2026-03-20T10:00:38.000Z';
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [],
      activeTurn: {
        id: 'turn-completed-task',
        prompt: 'analyze it',
        response: '',
        responseRole: 'assistant',
      },
      runtimeEvents: [
        {
          id: 'task-run:evt-task-start',
          sessionId: 'session-1',
          timestamp: start,
          kind: 'task',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: Analyze project',
        },
        {
          id: 'evt_task_activity_1',
          sessionId: 'session-1',
          timestamp: '2026-03-20T10:00:04.000Z',
          kind: 'task',
          phase: 'update',
          status: 'running',
          label: 'glob(README*)',
          detail: 'glob',
          parentId: 'task-run:evt-task-start',
        },
        {
          id: 'evt_task_activity_2',
          sessionId: 'session-1',
          timestamp: '2026-03-20T10:00:10.000Z',
          kind: 'task',
          phase: 'update',
          status: 'running',
          label: 'Read(package.json)',
          detail: 'read',
          parentId: 'task-run:evt-task-start',
        },
        {
          id: 'evt_task_end',
          sessionId: 'session-1',
          timestamp: end,
          kind: 'task',
          phase: 'end',
          status: 'done',
          label: 'Delegated task completed',
          detail: 'Codara is a terminal-first AI agent runtime.',
          parentId: 'task-run:evt-task-start',
        },
      ],
    });

    const completedTask = items.find((item) => item.role === 'task');
    expect(completedTask?.toolMeta?.summaryLine).toContain('Done');
    expect(completedTask?.toolMeta?.outputLines).toBeUndefined();
    expect(completedTask?.toolMeta?.allOutputLines).toBeUndefined();
    expect(completedTask?.content).not.toContain('Codara is a terminal-first AI agent runtime.');
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

  test('should render assistant-style background task follow-ups as assistant transcript items', () => {
    const items = buildTranscriptItems({
      notices: [
        {
          id: 'task-followup-1',
          level: 'assistant',
          content: 'Codara is a terminal-first AI agent runtime.',
        },
      ],
      coreMessages: [],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.role).toBe('assistant');
    expect(items[0]?.content).toContain('terminal-first AI agent runtime');
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


