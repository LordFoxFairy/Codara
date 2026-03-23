import React from 'react';
import {describe, expect, test} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import {Text} from 'ink';
import {render} from 'ink-testing-library';
import {
  type SolidifiedItem,
  buildCanonicalTranscriptFingerprint,
  buildSolidifiedItemsFromRange,
  buildActiveItems,
  createToolCallLookup,
  dedupeTrailingTranscriptItemsCoveredByRuntime,
  type TranscriptItem,
} from '@/cli/transcript/model';
import {
  filterSubagentCompletionTranscriptItems,
  orderActiveTranscriptItems,
  useSolidifiedTranscript,
} from '@/cli/hooks/use-solidified-transcript';
import type {CodaraRuntimeEvent} from '@/index';

describe('solidified transcript model', () => {
  function ActiveItemsProbe(props: Parameters<typeof useSolidifiedTranscript>[0]) {
    const {activeItems} = useSolidifiedTranscript(props);
    return React.createElement(
      Text,
      null,
      JSON.stringify(activeItems.map((item) => ({
        role: item.role,
        content: item.content,
        toolName: item.toolMeta?.toolName,
        summaryLine: item.toolMeta?.summaryLine,
      }))),
    );
  }

  describe('buildSolidifiedItemsFromRange', () => {
    test('should build items from a range of core messages', () => {
      const messages = [
        new HumanMessage('hello'),
        new AIMessage('world'),
        new HumanMessage('second'),
        new AIMessage('reply'),
      ];
      const toolLookup = createToolCallLookup(messages);

      const items = buildSolidifiedItemsFromRange(messages, 0, 4, toolLookup);
      expect(items).toHaveLength(4);
      expect(items[0]?.role).toBe('user');
      expect(items[0]?.content).toBe('hello');
      expect(items[1]?.role).toBe('assistant');
      expect(items[1]?.content).toBe('world');
      expect(items[2]?.role).toBe('user');
      expect(items[2]?.content).toBe('second');
      expect(items[3]?.role).toBe('assistant');
      expect(items[3]?.content).toBe('reply');
    });

    test('should build items from a partial range', () => {
      const messages = [
        new HumanMessage('hello'),
        new AIMessage('world'),
        new HumanMessage('second'),
        new AIMessage('reply'),
      ];
      const toolLookup = createToolCallLookup(messages);

      const items = buildSolidifiedItemsFromRange(messages, 2, 4, toolLookup);
      expect(items).toHaveLength(2);
      expect(items[0]?.content).toBe('second');
      expect(items[1]?.content).toBe('reply');
    });

    test('should include tool result items with toolMeta', () => {
      const bashCall: ToolCall = {id: 'call_bash_1', name: 'bash', args: {command: 'ls'}};
      const messages = [
        new AIMessage({content: '', tool_calls: [bashCall]}),
        new ToolMessage({content: 'file1.ts\nfile2.ts', tool_call_id: 'call_bash_1', name: 'bash'}),
      ];
      const toolLookup = createToolCallLookup(messages);

      const items = buildSolidifiedItemsFromRange(messages, 0, 2, toolLookup);
      expect(items).toHaveLength(1); // AIMessage with empty content is filtered, ToolMessage becomes tool item
      expect(items[0]?.role).toBe('tool');
      expect(items[0]?.toolMeta?.toolName).toBe('bash');
    });

    test('should keep delegated subagent launch tool messages as running execution blocks in the transcript', () => {
      const taskCall: ToolCall = {
        id: 'call_task_1',
        name: 'Agent',
        args: {prompt: 'Analyze the repo', subagent_type: 'Explore'},
      };
      const messages = [
        new AIMessage({content: '', tool_calls: [taskCall]}),
        new ToolMessage({
          content: [
            'Subagent started in background.',
            'run_id: call_123',
            'delegate_id: session:task:call_123',
            'agent: Explore',
          ].join('\n'),
          tool_call_id: 'call_task_1',
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
      ];
      const toolLookup = createToolCallLookup(messages);

      const items = buildSolidifiedItemsFromRange(messages, 0, 2, toolLookup);

      expect(items).toHaveLength(1);
      expect(items[0]?.role).toBe('agent');
      expect(items[0]?.content).toContain('⏺ Explore(Analyze the repo)');
      expect(items[0]?.content).toContain('Running');
    });

    test('should return empty array for empty range', () => {
      const messages = [new HumanMessage('hello')];
      const toolLookup = createToolCallLookup(messages);

      const items = buildSolidifiedItemsFromRange(messages, 0, 0, toolLookup);
      expect(items).toHaveLength(0);
    });
  });

  test('dedupes a completed subagent run when the same run is present in both trailing messages and runtime events', () => {
    const runtimeEvents: CodaraRuntimeEvent[] = [
      {
        id: 'subagent-run:run-cli',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'start',
        status: 'running',
        label: 'Delegating Explore: Analyze src/cli',
      },
      {
        id: 'task-end-run-cli',
        sessionId: 'session-1',
        timestamp: new Date(Date.now() + 1_000).toISOString(),
        kind: 'agent',
        phase: 'end',
        status: 'done',
        label: 'Subagent completed',
        parentId: 'subagent-run:run-cli',
      },
    ];

    const rendered = render(React.createElement(ActiveItemsProbe, {
      coreMessages: [
        new AIMessage({content: '', tool_calls: [{id: 'call-agent', name: 'Agent', args: {prompt: 'Analyze src/cli', subagent_type: 'Explore'}}]}),
        new ToolMessage({
          content: 'Subagent started in background.',
          tool_call_id: 'call-agent',
          name: 'Agent',
          artifact: {
            type: 'subagent_run_started',
            runId: 'run-cli',
            parentSessionId: 'session-1',
            sessionId: 'session:task:run-cli',
            agentName: 'Explore',
            label: 'Delegating Explore: Analyze src/cli',
          },
        }),
        new ToolMessage({
          content: 'Subagent completed successfully.',
          tool_call_id: 'call-agent',
          name: 'Agent',
          artifact: {
            type: 'subagent_result',
            runId: 'run-cli',
            sessionId: 'run-cli',
            turns: 0,
            reason: 'complete',
            label: 'Delegating Explore: Analyze src/cli',
            agentName: 'Explore',
            toolUseCount: 7,
            totalTokens: 1234,
          },
        }),
      ],
      notices: [],
      runtimeEvents,
    }));

    try {
      const frame = rendered.lastFrame() ?? '';
      const roleHits = (frame.match(/"role":"agent"/g) ?? []).length;
      expect(roleHits).toBe(1);
    } finally {
      rendered.unmount();
    }
  });

  test('suppresses trailing assistant text while the turn is still in subagent completion even after runtime blocks have settled', () => {
    const rendered = render(React.createElement(ActiveItemsProbe, {
      coreMessages: [
        new HumanMessage('请并行分析 src/cli 和 src/capability'),
        new AIMessage('src/cli 目录架构分析报告\n\n1. 目录结构\n- app/\n- components/'),
      ],
      notices: [],
      runState: {status: 'running', phase: 'subagent_completion'},
    }));

    try {
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('"role":"user"');
      expect(frame).not.toContain('src/cli 目录架构分析报告');
    } finally {
      rendered.unmount();
    }
  });

  test('suppresses trailing assistant text while live runtime subagent blocks already own the foreground before run summaries catch up', () => {
    const rendered = render(React.createElement(ActiveItemsProbe, {
      coreMessages: [
        new HumanMessage('并行分析 src/cli 和 src/capability'),
        new AIMessage('src/cli 目录架构分析报告\n\n1. 目录结构\n- app/\n- components/'),
      ],
      notices: [],
      runState: {status: 'running', phase: 'prompt_stream'},
      runtimeEvents: [
        {
          id: 'subagent-run:run-cli',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'agent',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: Analyze src/cli',
        },
      ],
      subagentRuns: [],
    }));

    try {
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('"role":"user"');
      expect(frame).not.toContain('src/cli 目录架构分析报告');
    } finally {
      rendered.unmount();
    }
  });

  test('filters child-style assistant replay out of finalized transcript items before they are solidified', () => {
    const items = filterSubagentCompletionTranscriptItems({
      completedTurnKind: 'prompt',
      items: [
        {
          id: 'assistant-child-report',
          role: 'assistant',
          content: 'src/cli 目录架构分析报告\n\n1. 目录结构\n- app/\n- components/',
        },
        {
          id: 'assistant-main',
          role: 'assistant',
          content: '最终结论：CLI 只负责宿主 UI 和输入映射。',
        },
      ],
      subagentRuns: [{
        runId: 'run-cli',
        parentSessionId: 'session-1',
        agentName: 'Explore',
        label: 'Explore',
        status: 'completed',
        startedAt: new Date(0).toISOString(),
        updatedAt: new Date(1).toISOString(),
        endedAt: new Date(1).toISOString(),
        summary: 'src/cli 目录架构分析报告\n\n1. 目录结构\n- app/\n- components/',
        toolUseCount: 12,
        totalTokens: 3456,
      }],
    });

    expect(items).toEqual([
      {
        id: 'assistant-main',
        role: 'assistant',
        content: '最终结论：CLI 只负责宿主 UI 和输入映射。',
      },
    ]);
  });

  describe('buildActiveItems', () => {
    test('should build items from activeTurn', () => {
      const items = buildActiveItems({
        activeTurn: {
          id: 'turn-1',
          prompt: 'hello',
          response: 'streaming...',
          responseRole: 'assistant',
        },
      });

      expect(items).toHaveLength(2);
      expect(items[0]?.role).toBe('user');
      expect(items[0]?.content).toBe('hello');
      expect(items[1]?.role).toBe('assistant');
      expect(items[1]?.content).toBe('streaming...');
    });

    test('should include runtime events when activeTurn is present', () => {
      const now = new Date().toISOString();
      const items = buildActiveItems({
        activeTurn: {
          id: 'turn-1',
          prompt: 'run it',
          response: '',
          responseRole: 'assistant',
        },
        runtimeEvents: [
          {
            id: 'evt_bash_start',
            sessionId: 'session-1',
            timestamp: now,
            kind: 'tool',
            phase: 'start',
            status: 'running',
            label: 'Bash(ls)',
            detail: 'bash',
          },
        ],
      });

      // prompt + running tool
      expect(items.some((i) => i.role === 'user')).toBe(true);
      expect(items.some((i) => i.role === 'tool')).toBe(true);
    });

    test('should keep post-runtime assistant text after runtime blocks when no pre-runtime text was captured', () => {
      const now = new Date().toISOString();
      const items = buildActiveItems({
        activeTurn: {
          id: 'turn-runtime-after',
          prompt: 'inspect it',
          response: 'I found the issue after the tool finished collecting data.',
          responseRole: 'assistant',
        },
        runtimeEvents: [
          {
            id: 'evt_bash_start',
            sessionId: 'session-1',
            timestamp: now,
            kind: 'tool',
            phase: 'start',
            status: 'running',
            label: 'Bash(ls)',
            detail: 'bash',
          },
        ],
      });

      expect(items.map((item) => item.role)).toEqual(['user', 'tool', 'assistant']);
      expect(items[2]?.content).toBe('I found the issue after the tool finished collecting data.');
    });

    test('should place assistant text before and after runtime blocks according to the runtime boundary', () => {
      const now = new Date().toISOString();
      const items = buildActiveItems({
        activeTurn: {
          id: 'turn-ordered',
          prompt: 'inspect it',
          responseBeforeRuntime: 'I will inspect the repo first.',
          response: 'I found the issue in the transcript ordering.',
          responseRole: 'assistant',
        },
        runtimeEvents: [
          {
            id: 'evt_bash_start',
            sessionId: 'session-1',
            timestamp: now,
            kind: 'tool',
            phase: 'start',
            status: 'running',
            label: 'Bash(ls)',
            detail: 'bash',
          },
        ],
      });

      expect(items.map((item) => item.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
      expect(items[1]?.content).toBe('I will inspect the repo first.');
      expect(items[3]?.content).toBe('I found the issue in the transcript ordering.');
    });

    test('should hide internal Skill runtime blocks from the active transcript', () => {
      const now = new Date().toISOString();
      const items = buildActiveItems({
        activeTurn: {
          id: 'turn-skill-ordered',
          prompt: 'brainstorm',
          responseBeforeRuntime: 'I will load the brainstorming skill first.',
          response: 'Now I can continue with the actual design discussion.',
          responseRole: 'assistant',
        },
        runtimeEvents: [
          {
            id: 'evt_skill_start',
            sessionId: 'session-1',
            timestamp: now,
            kind: 'tool',
            phase: 'start',
            status: 'running',
            label: 'Skill(superworkers:brainstorming)',
            detail: 'Skill',
          },
        ],
      });

      expect(items.map((item) => item.role)).toEqual(['user']);
    });

    test('should hide active assistant prose once the turn has been handed off to an AskUser review', () => {
      const items = buildActiveItems({
        activeTurn: {
          id: 'turn-ask-handoff',
          prompt: 'brainstorm',
          responseBeforeRuntime: '让我先了解一些基础信息。',
          response: '这段文字不应继续显示。',
          responseRole: 'assistant',
          suppressInteractionResponse: true,
        },
      });

      expect(items.map((item) => item.role)).toEqual(['user']);
    });

    test('renders subagent runtime blocks directly from agent events while the turn is active', () => {
      const items = buildActiveItems({
        activeTurn: {
          id: 'turn-running-elapsed',
          prompt: 'go',
          response: '',
          responseRole: 'assistant',
        },
        runtimeEvents: [
          {
            id: 'subagent-run:run-1',
            sessionId: 'session-1',
            timestamp: '2026-03-20T10:00:00.000Z',
            kind: 'agent',
            phase: 'start',
            status: 'running',
            label: 'Delegating Explore: Analyze project',
          },
        ],
        nowTimestamp: '2026-03-20T10:00:03.000Z',
      });

      expect(items.map((item) => item.role)).toEqual(['user', 'agent']);
      expect(items[1]?.content).toContain('⏺ Explore(Analyze project)');
      expect(items[1]?.content).toContain('Running');
    });

    test('should include runtime events even without activeTurn', () => {
      const now = new Date().toISOString();
      const items = buildActiveItems({
        runtimeEvents: [
          {
            id: 'evt_bash_start',
            sessionId: 'session-1',
            timestamp: now,
            kind: 'tool',
            phase: 'start',
            status: 'running',
            label: 'Bash(ls)',
            detail: 'bash',
          },
        ],
      });

      expect(items).toHaveLength(1);
      expect(items[0]?.role).toBe('tool');
    });

    test('should keep settled completed subagent runtime blocks visible while no newer main reply has replaced them yet', () => {
      const now = new Date().toISOString();
      const items = buildActiveItems({
        runtimeEvents: [
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
            id: 'evt_task_end_1',
            sessionId: 'session-1',
            timestamp: now,
            kind: 'agent',
            phase: 'end',
            status: 'done',
            label: 'Subagent completed',
            detail: 'Repository summary',
            parentId: 'subagent-run:run-1',
          },
        ],
      });

      expect(items).toHaveLength(1);
      expect(items[0]?.role).toBe('agent');
      expect(items[0]?.content).toContain('⏺ Explore(Analyze project)');
      expect(items[0]?.content).toContain('Done');
    });

    test('keeps the completed subagent block visible during continuation handoff before the main reply arrives', () => {
      const now = new Date().toISOString();
      const items = buildActiveItems({
        activeTurn: {
          id: 'turn-subagent-wait',
          prompt: '',
          response: '',
          responseRole: 'assistant',
          kind: 'subagent_completion',
          suppressInteractionResponse: true,
        },
        runtimeEvents: [
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
            id: 'evt_task_end_1',
            sessionId: 'session-1',
            timestamp: now,
            kind: 'agent',
            phase: 'end',
            status: 'done',
            label: 'Subagent completed',
            detail: 'Repository summary',
            parentId: 'subagent-run:run-1',
          },
        ],
      });

      expect(items).toHaveLength(1);
      expect(items[0]?.role).toBe('agent');
      expect(items[0]?.content).toContain('⏺ Explore(Analyze project)');
      expect(items[0]?.content).toContain('Done');
    });

    test('should filter empty content items', () => {
      const items = buildActiveItems({
        activeTurn: {
          id: 'turn-1',
          prompt: 'hello',
          response: '',
          responseRole: 'assistant',
        },
      });

      expect(items).toHaveLength(1);
      expect(items[0]?.content).toBe('hello');
    });

    test('should return empty array with no activeTurn and no events', () => {
      const items = buildActiveItems({});
      expect(items).toHaveLength(0);
    });
  });

  test('should not surface a completed Skill tool result in the active transcript while runtime events are still settling', () => {
    const skillToolCall: ToolCall = {
      id: 'call_skill_1',
      name: 'Skill',
      args: {skill: 'superworkers:brainstorming'},
    };
    const now = new Date().toISOString();
    const {lastFrame} = render(React.createElement(ActiveItemsProbe, {
      notices: [],
      coreMessages: [
        new AIMessage({content: '', tool_calls: [skillToolCall]}),
        new ToolMessage({
          content: '<command-name>superworkers:brainstorming</command-name>\n---\nname: brainstorming',
          tool_call_id: 'call_skill_1',
          name: 'Skill',
        }),
      ],
      runtimeEvents: [
        {
          id: 'evt_skill_start',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'tool',
          phase: 'start',
          status: 'running',
          label: 'Skill(superworkers:brainstorming)',
          detail: 'Skill',
        },
        {
          id: 'evt_skill_end',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'tool',
          phase: 'end',
          status: 'done',
          label: 'Skill(superworkers:brainstorming)',
          detail: '<command-name>superworkers:brainstorming</command-name>\n---\nname: brainstorming',
          parentId: 'evt_skill_start',
        },
      ],
    }));

    const serialized = lastFrame() ?? '';
    expect(serialized.includes('"toolName":"Skill"')).toBe(false);
  });

  describe('useSolidifiedTranscript', () => {
    test('should not duplicate the current prompt from unsolidified coreMessages while activeTurn is still in flight', () => {
      const {lastFrame} = render(React.createElement(ActiveItemsProbe, {
        coreMessages: [new HumanMessage('delegate it')],
        notices: [],
        activeTurn: {
          id: 'turn-live',
          prompt: 'delegate it',
          response: '',
          responseRole: 'assistant',
          kind: 'prompt',
        },
        runtimeEvents: [],
      }));

      const serialized = JSON.parse(lastFrame() ?? '[]') as Array<{role: string; content: string}>;
      const promptItems = serialized.filter((item) => item.role === 'user' && item.content === 'delegate it');
      expect(promptItems).toHaveLength(1);
    });

    test('should not prematurely solidify the current turn prompt when a new turn starts', () => {
      const previousTurnMessages = [
        new HumanMessage('previous prompt'),
        new AIMessage('previous reply'),
      ];
      const currentTurnMessages = [
        ...previousTurnMessages,
        new HumanMessage('delegate it'),
      ];

      const view = render(React.createElement(ActiveItemsProbe, {
        coreMessages: previousTurnMessages,
        notices: [],
        activeTurn: undefined,
        runtimeEvents: [],
      }));

      view.rerender(React.createElement(ActiveItemsProbe, {
        coreMessages: currentTurnMessages,
        notices: [],
        activeTurn: {
          id: 'turn-live',
          prompt: 'delegate it',
          response: '',
          responseRole: 'assistant',
          kind: 'prompt',
        },
        runtimeEvents: [],
      }));

      const serialized = JSON.parse(view.lastFrame() ?? '[]') as Array<{role: string; content: string}>;
      const promptItems = serialized.filter((item) => item.role === 'user' && item.content === 'delegate it');
      expect(promptItems).toHaveLength(1);
    });

    test('should keep trailing current-turn messages visible when an empty placeholder active turn does not own visible content', () => {
      const {lastFrame} = render(React.createElement(ActiveItemsProbe, {
        coreMessages: [new HumanMessage('delegate it')],
        notices: [],
        activeTurn: {
          id: 'turn-placeholder',
          prompt: '',
          response: '',
          responseRole: 'assistant',
          kind: 'subagent_completion',
          suppressInteractionResponse: true,
        },
        runtimeEvents: [
          {
            id: 'subagent-run:run-1',
            sessionId: 'session-1',
            timestamp: new Date().toISOString(),
            kind: 'agent',
            phase: 'start',
            status: 'running',
            label: 'Delegating Explore: Analyze structure',
          },
        ],
      }));

      const frame = lastFrame() ?? '';
      expect(frame).toContain('"role":"user"');
      expect(frame).toContain('"content":"delegate it"');
      expect(frame).toContain('"role":"agent"');
    });

    test('should suppress trailing assistant replay text while a live subagent block still owns the current turn', () => {
      const {lastFrame} = render(React.createElement(ActiveItemsProbe, {
        coreMessages: [
          new HumanMessage('delegate it'),
          new AIMessage('src/cli 目录架构分析报告\n1. 目录结构\n2. 核心职责'),
        ],
        notices: [],
        activeTurn: {
          id: 'turn-live-subagent',
          prompt: 'delegate it',
          response: '',
          responseRole: 'assistant',
          kind: 'prompt',
        },
        runtimeEvents: [
          {
            id: 'subagent-run:run-1',
            sessionId: 'session-1',
            timestamp: new Date().toISOString(),
            kind: 'agent',
            phase: 'start',
            status: 'running',
            label: 'Delegating Explore: Analyze structure',
          },
        ],
      }));

      const frame = lastFrame() ?? '';
      expect(frame).toContain('"role":"user","content":"delegate it"');
      expect(frame).toContain('"role":"agent"');
      expect(frame).not.toContain('src/cli 目录架构分析报告');
    });

    test('should keep suppressing finalized assistant text while a running subagent block still owns the current turn', () => {
      const {lastFrame} = render(React.createElement(ActiveItemsProbe, {
        coreMessages: [
          new HumanMessage('delegate it'),
          new AIMessage('Unified final answer from the main agent.'),
        ],
        notices: [],
        activeTurn: {
          id: 'turn-live-prompt',
          prompt: 'delegate it',
          response: '',
          responseRole: 'assistant',
          kind: 'prompt',
        },
        runtimeEvents: [
          {
            id: 'subagent-run:run-1',
            sessionId: 'session-1',
            timestamp: new Date().toISOString(),
            kind: 'agent',
            phase: 'start',
            status: 'running',
            label: 'Delegating Explore: Analyze structure',
          },
        ],
      }));

      const frame = lastFrame() ?? '';
      expect(frame.match(/"role":"user","content":"delegate it"/g)?.length ?? 0).toBe(1);
      expect(frame).toContain('"role":"agent"');
      expect(frame.replace(/\s+/g, ' ')).not.toContain('Unified final answer from the main agent.');
    });

    test('should hide child-style assistant replay text from the main transcript even after subagent runs have completed', () => {
      const {lastFrame} = render(React.createElement(ActiveItemsProbe, {
        coreMessages: [
          new HumanMessage('delegate it'),
          new AIMessage('src/cli 目录架构分析报告\n1. 目录结构\n2. 核心职责'),
        ],
        notices: [],
        activeTurn: {
          id: 'turn-finalize',
          prompt: 'delegate it',
          response: '',
          responseRole: 'assistant',
          kind: 'prompt',
        },
        runtimeEvents: [],
        runState: {status: 'done'},
        subagentRuns: [
          {
            runId: 'run-1',
            parentSessionId: 'session-1',
            label: 'Analyze src/cli',
            agentName: 'Explore',
            status: 'completed',
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            summary: 'src/cli 目录架构分析报告\n1. 目录结构\n2. 核心职责',
          },
        ],
      }));

      const frame = lastFrame() ?? '';
      expect(frame).toContain('"role":"user","content":"delegate it"');
      expect(frame).not.toContain('src/cli 目录架构分析报告');
    });

    test('should keep suppressing child-style assistant text while any subagent run is still active even if runState has already drifted to done', () => {
      const {lastFrame} = render(React.createElement(ActiveItemsProbe, {
        coreMessages: [
          new HumanMessage('delegate it'),
          new AIMessage('src/capability 目录架构分析报告\n1. 能力模块\n2. 生命周期管理'),
        ],
        notices: [],
        activeTurn: {
          id: 'turn-stale-done-active-subagent',
          prompt: 'delegate it',
          response: '',
          responseRole: 'assistant',
          kind: 'prompt',
        },
        runtimeEvents: [],
        runState: {status: 'done'},
        subagentRuns: [
          {
            runId: 'run-capability',
            parentSessionId: 'session-1',
            label: 'Analyze src/capability',
            agentName: 'Explore',
            status: 'running',
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            summary: 'src/capability 目录架构分析报告\n1. 能力模块\n2. 生命周期管理',
          },
        ],
      }));

      const frame = lastFrame() ?? '';
      expect(frame).toContain('"role":"user","content":"delegate it"');
      expect(frame).not.toContain('src/capability 目录架构分析报告');
    });
  });

  describe('orderActiveTranscriptItems', () => {
    test('should place task-completion runtime execution items before the trailing main-agent continuation reply', () => {
      const trailingItems: TranscriptItem[] = [
        {id: 'assistant-final', role: 'assistant', content: 'Unified main-agent summary'},
      ];
      const runtimeItems: TranscriptItem[] = [
        {
          id: 'active-subagent-run:run-1',
          role: 'agent',
          content: '⏺ Explore(Analyze structure)\n  ⎿ Done (5 tool uses · 1.2k tokens · 31s)',
        },
      ];
      const noticeItems: TranscriptItem[] = [
        {id: 'notice-1', role: 'system', content: 'ready'},
      ];

      const ordered = orderActiveTranscriptItems({
        trailingItems,
        runtimeItems,
        activeNoticeItems: noticeItems,
        latestCompletedTurnKind: 'subagent_completion',
      });

      expect(ordered.map((item) => item.id)).toEqual([
        'active-subagent-run:run-1',
        'assistant-final',
        'notice-1',
      ]);
    });

    test('should keep the user prompt ahead of a running subagent block while the main agent is waiting', () => {
      const ordered = orderActiveTranscriptItems({
        trailingItems: [
          {id: 'user-prompt', role: 'user', content: 'delegate it'},
        ],
        runtimeItems: [
          {id: 'active-subagent-run:run-1', role: 'agent', content: '⏺ Explore(Analyze structure)\n  ⎿ Running (3 tool uses · 16s)'},
        ],
        activeNoticeItems: [],
        latestCompletedTurnKind: 'prompt',
      });

      expect(ordered.map((item) => item.id)).toEqual([
        'user-prompt',
        'active-subagent-run:run-1',
      ]);
    });

    test('should remove trailing tool items already covered by active runtime items', () => {
      const trailingItems: TranscriptItem[] = [
        {
          id: 'core-skill-result',
          role: 'tool',
          content: '⏺ Skill(superworkers:brainstorming)\n---',
          toolMeta: {
            toolName: 'Skill',
            displayName: 'Skill',
            icon: '⏺',
            args: 'superworkers:brainstorming',
            status: 'done',
            summaryLine: '---',
          },
        },
      ];
      const runtimeItems: TranscriptItem[] = [
        {
          id: 'active-skill-result',
          role: 'tool',
          content: '⏺ Skill(superworkers:brainstorming)\n---',
          toolMeta: {
            toolName: 'Skill',
            displayName: 'Skill',
            icon: '⏺',
            args: 'superworkers:brainstorming',
            status: 'done',
            summaryLine: '---',
            elapsed: '15ms',
          },
        },
      ];

      expect(dedupeTrailingTranscriptItemsCoveredByRuntime(trailingItems, runtimeItems)).toEqual([]);
    });

    test('should remove trailing completed subagent blocks already covered by active runtime items even when runtime summary shape differs', () => {
      const trailingItems: TranscriptItem[] = [
        {
          id: 'core-agent-result',
          role: 'agent',
          content: '⏺ Explore(Analyze structure)\nDone (5 tool uses · 1.2k tokens)',
          toolMeta: {
            toolName: 'Agent',
            displayName: 'Explore',
            icon: '⏺',
            args: 'Analyze structure',
            status: 'done',
            summaryLine: 'Done (5 tool uses · 1.2k tokens)',
          },
        },
      ];
      const runtimeItems: TranscriptItem[] = [
        {
          id: 'active-subagent-run:run-1',
          role: 'agent',
          content: '⏺ Explore(Analyze structure)\nDone (33s)',
          toolMeta: {
            toolName: 'Agent',
            displayName: 'Explore',
            icon: '⏺',
            args: 'Analyze structure',
            status: 'done',
            summaryLine: 'Done (33s)',
            elapsed: '33s',
          },
        },
      ];

      expect(dedupeTrailingTranscriptItemsCoveredByRuntime(trailingItems, runtimeItems)).toEqual([]);
    });

    test('should fingerprint agent transcript items by run id before label or args', () => {
      const runtimeItem: TranscriptItem = {
        id: 'active-subagent-run:run-123',
        role: 'agent',
        content: '⏺ Explore(Analyze structure)\nDone (33s)',
        toolMeta: {
          toolName: 'Agent',
          displayName: 'Explore',
          icon: '⏺',
          args: 'Analyze structure',
          runId: 'run-123',
          status: 'done',
          summaryLine: 'Done (33s)',
        },
      };
      const trailingItem: TranscriptItem = {
        id: 'core-agent-result',
        role: 'agent',
        content: '⏺ Explore(Analyze structure)\nDone (5 tool uses · 1.2k tokens)',
        toolMeta: {
          toolName: 'Agent',
          displayName: 'Explore',
          icon: '⏺',
          args: 'Analyze structure but with slightly different prompt text',
          runId: 'run-123',
          status: 'done',
          summaryLine: 'Done (5 tool uses · 1.2k tokens)',
        },
      };

      expect(buildCanonicalTranscriptFingerprint(runtimeItem)).toBe('agent|run-123');
      expect(buildCanonicalTranscriptFingerprint(trailingItem)).toBe('agent|run-123');
      expect(dedupeTrailingTranscriptItemsCoveredByRuntime([trailingItem], [runtimeItem])).toEqual([]);
    });

    test('should keep a subagent block stable across running and done phases even when runId is missing', () => {
      const runningItem: TranscriptItem = {
        id: 'active-subagent-run:call-agent-1',
        role: 'agent',
        content: '⏺ Explore(Analyze structure)\nRunning',
        toolMeta: {
          toolName: 'Agent',
          displayName: 'Explore',
          icon: '⏺',
          args: 'Analyze structure',
          status: 'running',
          summaryLine: 'Running',
        },
      };
      const doneItem: TranscriptItem = {
        id: 'core-agent-result',
        role: 'agent',
        content: '⏺ Explore(Analyze structure)\nDone (5 tool uses · 1.2k tokens)',
        toolMeta: {
          toolName: 'Agent',
          displayName: 'Explore',
          icon: '⏺',
          args: 'Analyze structure',
          status: 'done',
          summaryLine: 'Done (5 tool uses · 1.2k tokens)',
        },
      };

      expect(buildCanonicalTranscriptFingerprint(runningItem)).toBe('agent|Explore|Analyze structure');
      expect(buildCanonicalTranscriptFingerprint(doneItem)).toBe('agent|Explore|Analyze structure');
      expect(dedupeTrailingTranscriptItemsCoveredByRuntime([doneItem], [runningItem])).toEqual([]);
    });
  });

  describe('filterSubagentCompletionTranscriptItems', () => {
    test('filters internal child-style assistant text even when subagent summaries are not available yet', () => {
      const items = filterSubagentCompletionTranscriptItems({
        completedTurnKind: 'subagent_completion',
        items: [
          {id: 'assistant-invalid', role: 'assistant', content: 'Phase 1 has started. Waiting for subagent results.'},
          {id: 'task-1', role: 'agent', content: 'Explore(Analyze CLI)\nRunning...'},
          {id: 'assistant-valid', role: 'assistant', content: 'Unified final answer from the main agent.'},
        ],
      });

      expect(items.map((item) => item.id)).toEqual(['task-1', 'assistant-valid']);
    });

    test('keeps assistant items untouched when they are not internal subagent text', () => {
      const items = filterSubagentCompletionTranscriptItems({
        completedTurnKind: 'prompt',
        items: [
          {id: 'assistant-1', role: 'assistant', content: 'Unified final answer from the main agent.'},
        ],
      });

      expect(items.map((item) => item.id)).toEqual(['assistant-1']);
    });

    test('keeps valid explanatory assistant answers during subagent-completion turns', () => {
      const items = filterSubagentCompletionTranscriptItems({
        completedTurnKind: 'subagent_completion',
        items: [
          {
            id: 'assistant-valid',
            role: 'assistant',
            content: '这种设计确保了 main agent 能够在 subagent 完成后自动继续工作，无需用户干预。',
          },
        ],
      });

      expect(items.map((item) => item.id)).toEqual(['assistant-valid']);
    });
  });

  describe('SolidifiedItem type', () => {
    test('should support welcome kind', () => {
      const item: SolidifiedItem = {
        id: 'welcome-1',
        kind: 'welcome',
        items: [],
      };
      expect(item.kind).toBe('welcome');
    });

    test('should support turn kind with items', () => {
      const item: SolidifiedItem = {
        id: 'turn-1',
        kind: 'turn',
        items: [
          {id: 'msg-1', role: 'user', content: 'hello'},
          {id: 'msg-2', role: 'assistant', content: 'world'},
        ],
      };
      expect(item.kind).toBe('turn');
      expect(item.items).toHaveLength(2);
    });

    test('should support notice kind', () => {
      const item: SolidifiedItem = {
        id: 'notice-1',
        kind: 'notice',
        items: [{id: 'n1', role: 'system', content: 'ready'}],
      };
      expect(item.kind).toBe('notice');
    });
  });
});
