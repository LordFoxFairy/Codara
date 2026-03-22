import {describe, expect, test} from 'bun:test';
import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import {buildActiveItems, buildTranscriptItems, hasTranscriptContent} from '@/cli/transcript/model';
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

  test('should keep shared task coordination tool output visible in the main transcript', () => {
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

    expect(items.map((item) => item.role)).toEqual(['tool']);
    expect(items[0]?.content).toContain('Tasks:');
    expect(items[0]?.content).toContain('- id: task-1 | subject: Inspect transcript | status: in_progress');
    expect(items[0]?.content).toContain('- id: task-2 | subject: Report result | status: pending');
  });

  test('should suppress shared task coordination tool output when it is marked internal by artifact metadata', () => {
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

  test('should render unknown non-task tool outputs as ordinary tool results', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({
          content: '',
          tool_calls: [
            {id: 'call_launch_helper', name: 'launch_helper', args: {name: '架构分析员'}} as ToolCall,
          ],
        }),
        new ToolMessage({
          content: JSON.stringify({
            helperId: 'helper_a',
            name: '架构分析员',
            role: 'analyst',
            status: 'started',
          }),
          tool_call_id: 'call_launch_helper',
          name: 'launch_helper',
        }),
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.role).toBe('tool');
    expect(items[0]?.toolMeta?.displayName).toBe('Launch Helper');
    expect(items[0]?.content).toContain('架构分析员');
  });

  test('should keep assistant text even if it contains old collaborative wording without a live delegated subagent run', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({
          content: '我将立即在当前团队中组织 3 个只读 workers 开始分析工作！',
        }),
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.role).toBe('assistant');
    expect(items[0]?.content).toContain('当前团队中组织');
  });

  test('should hide AskUser tool call groups because the review panel already renders the interaction', () => {
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

    expect(items).toEqual([]);
  });

  test('should hide Skill tool results from the transcript because skill loading is internal', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({
          content: '',
          tool_calls: [
            {id: 'call_skill_1', name: 'Skill', args: {skill: 'superworkers:brainstorming'}} as ToolCall,
          ],
        }),
        new ToolMessage({
          content: '<command-name>superworkers:brainstorming</command-name>\n---\nname: brainstorming',
          tool_call_id: 'call_skill_1',
          name: 'Skill',
        }),
      ],
    });

    expect(items).toEqual([]);
  });

  test('should hide AskUser tool results and review runtime noise after the interaction completes', () => {
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
          kind: 'review',
          phase: 'end',
          status: 'done',
          label: 'Review selection applied',
        },
      ],
    });

    expect(items).toEqual([]);
  });

  test('should hide runtime tool blocks that end in a permission review pause payload', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [],
      activeTurn: {
        id: 'turn-read-permission',
        prompt: 'read it',
        response: '',
        responseRole: 'assistant',
      },
      runtimeEvents: [
        {
          id: 'evt_read_start',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'tool',
          phase: 'start',
          status: 'running',
          label: 'Read(/Users/nako/WebstormProjects/github/thefoxfairy/Codara/README.md)',
          detail: 'read_file',
        },
        {
          id: 'evt_read_end',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'tool',
          phase: 'end',
          status: 'done',
          parentId: 'evt_read_start',
          label: 'Read(/Users/nako/WebstormProjects/github/thefoxfairy/Codara/README.md)',
          detail: JSON.stringify({
            type: 'review_pause',
            request: {
              id: 'pause-1',
              description: 'Codara wants to read this file.',
              action: {
                toolCallId: 'call-1',
                toolName: 'read_file',
                toolArgs: {file_path: '/Users/nako/WebstormProjects/github/thefoxfairy/Codara/README.md', offset: 0, limit: 500},
              },
              review: {actionName: 'read_file', allowedDecisions: ['approve', 'edit', 'reject']},
              runtime: {runId: 'run-1', turn: 1, requestId: 'req-1', toolIndex: 0},
            },
          }),
        },
      ],
    });

    expect(items).toEqual([
      {
        id: 'turn-read-permission-prompt',
        role: 'user',
        content: 'read it',
      },
    ]);
  });

  test('should hide internal AskUser continuation-guard tool messages from the transcript', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new ToolMessage({
          content: [
            'AskUserQuestion was just answered in this flow. Do not open another questionnaire immediately.',
            'Collected answers: {"interaction":"对话式（Chat）"}',
          ].join('\n'),
          tool_call_id: 'call_ask_repeat_block',
          name: 'AskUserQuestion',
          artifact: {
            type: 'ask_user_internal',
            visibility: 'hidden',
            reason: 'continuation_guard',
          },
        }),
      ],
    });

    expect(items).toEqual([]);
  });

  test('should hide internal AskUser continuation-guard tool messages even without tool-name resolution', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new ToolMessage({
          content: [
            'AskUserQuestion was just answered in this flow. Do not open another questionnaire immediately.',
            'Collected answers: {"interaction":"对话式（Chat）"}',
          ].join('\n'),
          tool_call_id: 'call_ask_repeat_block_unresolved',
          artifact: {
            type: 'ask_user_internal',
            visibility: 'hidden',
            reason: 'continuation_guard',
          },
        }),
      ],
    });

    expect(items).toEqual([]);
  });

  test('should hide blocked repeat AskUser runtime tool chatter while streaming', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [],
      activeTurn: {
        id: 'turn-ask-repeat',
        prompt: 'continue',
        response: '',
        responseRole: 'assistant',
      },
      runtimeEvents: [
        {
          id: 'evt_ask_repeat_start',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'tool',
          phase: 'start',
          status: 'running',
          label: 'AskUserQuestion(summary: Clarify the brief)',
          detail: 'AskUserQuestion',
        },
        {
          id: 'evt_ask_repeat_end',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'tool',
          phase: 'end',
          status: 'done',
          label: 'Tool completed',
          detail: [
            'AskUserQuestion was just answered in this flow. Do not open another questionnaire immediately.',
            'Use the collected answers below and continue the original task unless the user explicitly asked for another form.',
          ].join(' '),
          parentId: 'evt_ask_repeat_start',
        },
      ],
    });

    expect(items.map((item) => item.role)).toEqual(['user']);
    expect(items.some((item) => item.content.includes('AskUserQuestion was just answered in this flow'))).toBe(false);
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
        prompt: 'coordinate the delegation flow',
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

  test('should keep raw subagent runtime end details out of the main transcript during streaming', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({
          content: '',
          tool_calls: [{id: 'call_task_1', name: 'Agent', args: {prompt: 'Inspect child work'}} as ToolCall],
        }),
        new ToolMessage({content: 'Subagent completed.\nsummary:\nCHILD_DONE', tool_call_id: 'call_task_1'}),
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
          kind: 'agent',
          phase: 'end',
          status: 'done',
          label: 'Subagent completed',
          detail: 'CHILD_DONE',
        },
      ],
    });

    expect(items.map((item) => item.role)).toEqual(['user', 'tool']);
    expect(items.some((item) => item.content.includes('CHILD_DONE'))).toBe(false);
  });

  test('should suppress assistant launch chatter while keeping the delegated subagent block visible in the timeline', () => {
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
          id: 'subagent-run:run-2',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'agent',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: Analyze project',
        },
      ],
    });

    expect(items.map((item) => item.role)).toEqual(['user', 'agent']);
    expect(items.some((item) => item.content.includes('任务已启动'))).toBe(false);
    expect(items[1]?.content).toContain('⚙ Explore(Analyze project)');
  });

  test('should suppress active launch chatter when the streaming response already contains an Agent tool call', () => {
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
        pendingAgentLaunch: true,
      },
      runtimeEvents: [],
    });

    expect(items.map((item) => item.role)).toEqual(['user']);
    expect(items.some((item) => item.content.includes('任务已启动'))).toBe(false);
  });

  test('should suppress pre-runtime launch chatter buffered before the subagent runtime block starts', () => {
    const now = new Date().toISOString();
    const items = buildActiveItems({
      activeTurn: {
        id: 'turn-task-launch-pre-runtime',
        prompt: 'delegate it',
        responseBeforeRuntime: '我将立即并行委派两个只读 Explore subagent 来分析这两个核心目录：',
        response: '',
        responseRole: 'assistant',
        pendingAgentLaunch: true,
        suppressAgentLaunchResponse: true,
      },
      runtimeEvents: [
        {
          id: 'subagent-run:run-cli',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'agent',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: Analyze src/cli',
        },
      ],
    });

    expect(items.map((item) => item.role)).toEqual(['user', 'agent']);
    expect(items.some((item) => item.content.includes('我将立即并行委派'))).toBe(false);
  });

  test('should suppress solidified assistant launch chatter while keeping the delegated running subagent block', () => {
    const taskCall: ToolCall = {
      id: 'call_task_launch_noise',
      name: 'Agent',
      args: {prompt: 'Analyze the repo', subagent_type: 'Explore'},
    };
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({content: '', tool_calls: [taskCall]}),
        new ToolMessage({
          content: [
            'Subagent started in background.',
            'Do not restate launch metadata or promise follow-up.',
            'Wait for runtime updates, review requests, or the delegated result.',
          ].join('\n'),
          tool_call_id: 'call_task_launch_noise',
          name: 'Agent',
          artifact: {
            type: 'subagent_run_started',
            runId: 'call_task_launch_noise',
            parentSessionId: 'session-1',
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

    expect(items).toHaveLength(1);
    expect(items[0]?.role).toBe('agent');
    expect(items[0]?.content).toContain('⚙ Explore(Analyze the repo)');
    expect(items[0]?.content).toContain('Running');
  });

  test('should suppress solidified launch chatter on an AI message that also contains an Agent tool call', () => {
    const taskCall: ToolCall = {
      id: 'call_task_launch_inline',
      name: 'Agent',
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

  test('should suppress alternative launch-only assistant prose while keeping the delegated subagent tool block', () => {
    const taskCall: ToolCall = {
      id: 'call_task_launch_alt',
      name: 'Agent',
      args: {prompt: 'Analyze the repo', subagent_type: 'Explore'},
    };
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new HumanMessage('delegate it'),
        new AIMessage({content: '', tool_calls: [taskCall]}),
        new ToolMessage({
          content: [
            'Subagent started in background.',
            'run_id: call_123',
            'delegate_id: session:task:call_123',
          ].join('\n'),
          tool_call_id: 'call_task_launch_alt',
          name: 'Agent',
          artifact: {
            type: 'subagent_run_started',
            runId: 'call_123',
            parentSessionId: 'session-1',
            sessionId: 'session:task:call_123',
            agentName: 'Explore',
            label: 'Delegating Explore: Analyze the repo',
          },
        }),
        new AIMessage('我已启动只读 Explore subagent (run_id: call_123) 来分析项目。待该代理完成并返回结果后，我将立即给出不超过5句的总结。'),
      ],
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      id: 'human-0',
      role: 'user',
      content: 'delegate it',
    });
    expect(items[1]?.role).toBe('agent');
    expect(items[1]?.content).toContain('⚙ Explore(Analyze the repo)');
    expect(items[1]?.content).toContain('Running');
    expect(items[1]?.toolMeta?.status).toBe('running');
  });

  test('should hide a subagent launch tool message once a completed subagent result for the same tool call exists', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_task_pair',
            name: 'Agent',
            args: {prompt: 'Analyze the repo', subagent_type: 'Explore'},
          } as ToolCall],
        }),
        new ToolMessage({
          content: 'Subagent started in background.',
          tool_call_id: 'call_task_pair',
          name: 'Agent',
          artifact: {
            type: 'subagent_run_started',
            runId: 'call_task_pair',
            parentSessionId: 'session-1',
            sessionId: 'session-1:agent:call_task_pair',
            agentName: 'Explore',
            label: 'Delegating Explore: Analyze the repo',
          },
        }),
        new ToolMessage({
          content: 'Subagent completed.\nsummary:\nDone',
          tool_call_id: 'call_task_pair',
          artifact: {
            type: 'subagent_result',
            sessionId: 'session-1:agent:call_task_pair',
            turns: 4,
            reason: 'complete',
            runId: 'call_task_pair',
            label: 'Delegating Explore: Analyze the repo',
            agentName: 'Explore',
            summary: 'Done',
            toolUseCount: 2,
            totalTokens: 900,
          },
        }),
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.role).toBe('agent');
    expect(items[0]?.content).toContain('Done (2 tool uses · 900 tokens)');
  });

  test('should render completed task tool results as compact execution summaries instead of raw child output', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_task_1',
            name: 'Agent',
            args: {prompt: 'Inspect child work', subagent_type: 'Explore'},
          } as ToolCall],
        }),
        new ToolMessage({
          content: 'Subagent completed.\nsummary:\nCHILD_DONE',
          tool_call_id: 'call_task_1',
          artifact: {
            type: 'subagent_result',
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
    expect(items[0]?.role).toBe('agent');
    expect(items[0]?.content).toContain('⚙ Explore(Inspect child work)');
    expect(items[0]?.content).toContain('Done (3 tool uses · 14.4k tokens)');
    expect(items[0]?.content).not.toContain('CHILD_DONE');
    expect(items[0]?.toolMeta?.summaryLine).toBe('Done (3 tool uses · 14.4k tokens)');
  });

  test('should fall back to tool_call_id as the canonical run id for completed subagent results when artifact.runId is missing', () => {
    const items = buildTranscriptItems({
      notices: [],
      coreMessages: [
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_task_missing_run_id',
            name: 'Agent',
            args: {prompt: 'Inspect child work', subagent_type: 'Explore'},
          } as ToolCall],
        }),
        new ToolMessage({
          content: 'Subagent completed.\nsummary:\nCHILD_DONE',
          tool_call_id: 'call_task_missing_run_id',
          artifact: {
            type: 'subagent_result',
            sessionId: 'session:task:call_task_missing_run_id',
            turns: 4,
            reason: 'complete',
            summary: 'CHILD_DONE',
            toolUseCount: 3,
            totalTokens: 14400,
          },
        }),
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.role).toBe('agent');
    expect(items[0]?.toolMeta?.runId).toBe('call_task_missing_run_id');
  });

  test('should show only the real delegated subagent block when runtime task roots and synthetic placeholders both exist', () => {
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
          detail: 'Agent',
        },
        {
          id: 'synthetic-task-root-1',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'agent',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: Analyze project',
          parentId: 'tool-root-1',
        },
        {
          id: 'subagent-run:run-1',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'agent',
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
          kind: 'agent',
          phase: 'end',
          status: 'done',
          label: 'Subagent running in background',
          detail: 'run_id: run-1\ndelegate_id: session-1:task:run-1',
          parentId: 'synthetic-task-root-1',
        },
        {
          id: 'runtime-task-update-1',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'agent',
          phase: 'update',
          status: 'paused',
          label: 'Subagent waiting for review',
          detail: 'Need confirmation',
          parentId: 'subagent-run:run-1',
        },
      ],
    });

    const exploreItems = items.filter((item) => item.content.includes('⚙ Explore('));
    expect(exploreItems).toHaveLength(1);
    expect(exploreItems[0]?.content).toContain('Running');
  });

  test('should hide bookkeeping subagent runtime events like Subagent started and background-launch status lines', () => {
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
          kind: 'agent',
          phase: 'end',
          status: 'done',
          label: 'Subagent started',
          parentId: 'pending-call-1',
        },
        {
          id: 'evt-task-launch-finished',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'agent',
          phase: 'end',
          status: 'done',
          label: 'Subagent running in background',
          detail: 'Subagent started in background.',
          parentId: 'tool-call-1',
        },
      ],
    });

    expect(items.some((item) => item.content.includes('Subagent started'))).toBe(false);
    expect(items.some((item) => item.content.includes('Subagent running in background'))).toBe(false);
    expect(items.some((item) => item.content.includes('Subagent started in background.'))).toBe(false);
  });

  test('should ignore pre-registered pending task placeholders while keeping the real delegated subagent blocks', () => {
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
          kind: 'agent',
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
          kind: 'agent',
          phase: 'end',
          status: 'done',
          label: 'Subagent started',
          parentId: 'pending-task-tech',
        },
        {
          id: 'subagent-run:run-tech',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'agent',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: 分析当前项目的技术栈、主要依赖和运行方式。请只读检查：',
        },
        {
          id: 'runtime-task-tech-end',
          sessionId: 'session-1',
          timestamp: later,
          kind: 'agent',
          phase: 'end',
          status: 'done',
          label: 'Subagent completed',
          detail: 'tech summary',
          parentId: 'subagent-run:run-tech',
        },
        {
          id: 'subagent-run:run-structure',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'agent',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: 分析当前项目的目录结构、核心模块和主要入口。请只读检查：',
        },
      ],
    });

    const exploreItems = items.filter((item) => item.content.includes('⚙ Explore('));
    expect(exploreItems).toHaveLength(2);
    expect(exploreItems[0]?.content).not.toContain('pending');
    expect(exploreItems[1]?.content).not.toContain('pending');
  });

  test('should show the delegated subagent block without leaking child activity lines into the main transcript body', () => {
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
          id: 'subagent-run:evt-task-start',
          sessionId: 'session-1',
          timestamp: start,
          kind: 'agent',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: Analyze the repo',
        },
        {
          id: 'evt_task_a',
          sessionId: 'session-1',
          timestamp: update,
          kind: 'agent',
          phase: 'update',
          status: 'running',
          label: 'glob(README*)',
          detail: 'glob',
          parentId: 'subagent-run:evt-task-start',
        },
        {
          id: 'evt_task_b',
          sessionId: 'session-1',
          timestamp: update,
          kind: 'agent',
          phase: 'update',
          status: 'running',
          label: 'Read(package.json)',
          detail: 'read',
          parentId: 'subagent-run:evt-task-start',
        },
        {
          id: 'evt_task_c',
          sessionId: 'session-1',
          timestamp: update,
          kind: 'agent',
          phase: 'update',
          status: 'running',
          label: 'Read(src/index.ts)',
          detail: 'read',
          parentId: 'subagent-run:evt-task-start',
        },
        {
          id: 'evt_task_d',
          sessionId: 'session-1',
          timestamp: update,
          kind: 'agent',
          phase: 'update',
          status: 'running',
          label: 'Read(src/core/agent.ts)',
          detail: 'read',
          parentId: 'subagent-run:evt-task-start',
        },
      ],
    });

    const exploreItems = items.filter((item) => item.content.includes('⚙ Explore('));
    expect(exploreItems).toHaveLength(1);
    expect(exploreItems[0]?.content).toContain('Running');
    expect(exploreItems[0]?.content).not.toContain('glob(');
    expect(exploreItems[0]?.content).not.toContain('Read(');
  });

  test('should keep the completed subagent block visible without leaking raw child activity lines into the main transcript body', () => {
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
          id: 'subagent-run:evt-task-start',
          sessionId: 'session-1',
          timestamp: start,
          kind: 'agent',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: Analyze project',
        },
        {
          id: 'evt_task_activity_1',
          sessionId: 'session-1',
          timestamp: '2026-03-20T10:00:04.000Z',
          kind: 'agent',
          phase: 'update',
          status: 'running',
          label: 'glob(README*)',
          detail: 'glob',
          parentId: 'subagent-run:evt-task-start',
        },
        {
          id: 'evt_task_activity_2',
          sessionId: 'session-1',
          timestamp: '2026-03-20T10:00:10.000Z',
          kind: 'agent',
          phase: 'update',
          status: 'running',
          label: 'Read(package.json)',
          detail: 'read',
          parentId: 'subagent-run:evt-task-start',
        },
        {
          id: 'evt_task_end',
          sessionId: 'session-1',
          timestamp: end,
          kind: 'agent',
          phase: 'end',
          status: 'done',
          label: 'Subagent completed',
          detail: 'Codara is a terminal-first AI agent runtime.',
          parentId: 'subagent-run:evt-task-start',
        },
      ],
    });

    const exploreItems = items.filter((item) => item.content.includes('⚙ Explore('));
    expect(exploreItems).toHaveLength(1);
    expect(exploreItems[0]?.content).toContain('Done');
    expect(items.some((item) => item.content.includes('Codara is a terminal-first AI agent runtime.'))).toBe(false);
  });

  test('should summarize delegated agent prompts instead of exposing multiline prompt bodies in transcript items', () => {
    const now = '2026-03-20T10:00:00.000Z';
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
          id: 'subagent-run:evt-task-start',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'agent',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: 只读分析 `src/cli` 目录的架构：\n\n**目标**：\n1. 列出目录结构\n2. 识别核心职责',
        },
      ],
    });

    const exploreItem = items.find((item) => item.role === 'agent');
    expect(exploreItem?.toolMeta?.args).toBe('只读分析 `src/cli` 目录的架构：');
    expect(exploreItem?.content).not.toContain('**目标**');
    expect(exploreItem?.content).not.toContain('\n\n**目标**');
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
