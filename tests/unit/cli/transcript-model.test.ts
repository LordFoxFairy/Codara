import {describe, expect, test} from 'bun:test';
import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import {buildActiveItems, buildTranscriptItems, hasTranscriptContent} from '@/cli/transcript/model';

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
    expect(items.map((item) => item.role)).toEqual(['tool']);
    expect(items[0]?.content).toContain('Tasks:');
    expect(items[0]?.content).toContain('- id: task-1 | subject: Inspect transcript | status: in_progress');
    expect(items[0]?.content).toContain('- id: task-2 | subject: Report result | status: pending');
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

  test('should suppress assistant launch chatter while a delegated task runtime block is active', () => {
    const now = new Date().toISOString();
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [],
      activeTurn: {
        id: 'turn-task-launch-chatter',
        prompt: 'delegate it',
        response: [
          '✅ 任务已启动！',
          '我已使用 Task 工具委派了一个 Explore subagent 来分析 Codara 项目。',
          '委派信息：',
          '  • 🤖 Subagent 类型: Explore（只读探索代理）',
          '正在等待 subagent 完成分析...',
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

    expect(items.map((item) => item.role)).toEqual(['user', 'task']);
    expect(items.some((item) => item.content.includes('任务已启动'))).toBe(false);
  });

  test('should suppress active launch chatter when the streaming response already contains a Task tool call', () => {
    const items = buildActiveItems({
      activeTurn: {
        id: 'turn-task-launch-stream',
        prompt: 'delegate it',
        response: [
          '✅ 任务已启动！',
          '我已使用 Task 工具委派了一个 Explore subagent 来分析项目。',
          '委派信息：',
        ].join('\n'),
        responseRole: 'assistant',
        pendingTaskLaunch: true,
      },
      runtimeEvents: [],
    });

    expect(items.map((item) => item.role)).toEqual(['user']);
    expect(items.some((item) => item.content.includes('任务已启动'))).toBe(false);
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
          '✅ 任务已启动！',
          '我已使用 Task 工具委派了一个 Explore subagent 来分析项目。',
          '委派信息：',
          '正在等待 subagent 完成分析...',
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
            '✅ 任务已启动！',
            '我已使用 Task 工具委派了一个 Explore subagent 来分析项目。',
            '委派信息：',
            '正在等待 subagent 完成分析...',
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
    expect(items[0]?.content).toContain('⚙ Explore(Inspect child work)');
    expect(items[0]?.content).toContain('Done (3 tool uses · 14.4k tokens)');
    expect(items[0]?.content).not.toContain('CHILD_DONE');
    expect(items[0]?.toolMeta?.summaryLine).toBe('Done (3 tool uses · 14.4k tokens)');
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

    const exploreItems = items.filter((item) => item.content.includes('⚙ Explore('));
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
          label: 'Delegating Explore: 分析当前项目的技术栈、主要依赖和运行方式。请只读检查：',
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
          label: 'Delegating Explore: 分析当前项目的技术栈、主要依赖和运行方式。请只读检查：',
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
          label: 'Delegating Explore: 分析当前项目的目录结构、核心模块和主要入口。请只读检查：',
        },
      ],
    });

    const exploreItems = items.filter((item) => item.content.includes('⚙ Explore('));
    expect(exploreItems).toHaveLength(2);
    const techItems = exploreItems.filter((item) => item.content.includes('技术栈、主要依赖和运行方式'));
    expect(techItems).toHaveLength(1);
    expect(techItems[0]?.content).not.toContain('Done (0s)');
  });

  test('should render running tasks with recent activity lines and a collapsed activity count', () => {
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

    const runningTask = items.find((item) => item.content.includes('⚙ Explore('));
    expect(runningTask?.toolMeta?.status).toBe('running');
    expect(runningTask?.toolMeta?.summaryLine).toContain('Running');
    expect(runningTask?.toolMeta?.summaryLine).toContain('4 tool activities');
    expect(runningTask?.toolMeta?.outputLines).toEqual([
      'Read(package.json)',
      'Read(src/index.ts)',
      'Read(src/core/agent.ts)',
    ]);
    expect(runningTask?.toolMeta?.totalOutputLines).toBe(4);
  });

  test('should render completed tasks with child tool activity lines instead of repeating the final summary body', () => {
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

    const completedTask = items.find((item) => item.content.includes('⚙ Explore('));
    expect(completedTask?.toolMeta?.summaryLine).toContain('Done');
    expect(completedTask?.toolMeta?.allOutputLines).toEqual(['glob(README*)', 'Read(package.json)']);
    expect(completedTask?.toolMeta?.allOutputLines).not.toContain('Codara is a terminal-first AI agent runtime.');
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
