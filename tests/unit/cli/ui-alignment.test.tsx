import {describe, expect, it} from 'bun:test';
import {render} from 'ink-testing-library';
import {StatusBar} from '../../../src/cli/components/chrome/header';
import {SubagentRunPanel} from '../../../src/cli/components/chrome/subagent-run-panel';
import {ActiveTranscript, Transcript} from '../../../src/cli/components/conversation/transcript';
import {SolidifiedBlock} from '../../../src/cli/components/conversation/solidified-block';
import {StaticWelcome, deriveRecentSessions} from '../../../src/cli/components/conversation/welcome-state';
import {SessionPicker} from '../../../src/cli/components/conversation/session-picker';
import {resolveCliForegroundSurface} from '../../../src/cli/app/shell-app';
import {HumanMessage, AIMessage} from '@langchain/core/messages';
import type {SessionState} from '@/index';
import type {SessionPickerItem} from '../../../src/cli/hooks/use-session-picker';
import type {ActiveSubagentRun} from '../../../src/cli/hooks/use-subagent-runs';
import type {TranscriptItem} from '../../../src/cli/transcript/model';

describe('UI alignment with Claude Code', () => {
  describe('Welcome → Conversation transition', () => {
    it('should show welcome when no conversation', () => {
      expect(resolveCliForegroundSurface({hasReview: false, hasConversation: false})).toBe('welcome');
    });

    it('should show transcript when conversation exists', () => {
      expect(resolveCliForegroundSurface({hasReview: false, hasConversation: true})).toBe('transcript');
    });

    it('should keep transcript foreground when review is active', () => {
      expect(resolveCliForegroundSurface({hasReview: true, hasConversation: true})).toBe('transcript');
    });
  });

  describe('StatusBar (lightweight, no border)', () => {
    it('should render subtitle and path without border or title', () => {
      const session: SessionState = {
        sessionId: '12345678-aaaa-bbbb-cccc-1234567890ab',
        sessionStatus: 'ready',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {
          title: 'Some title',
          messageCount: 5,
          lastActivity: new Date().toISOString(),
          contextWindow: {maxInputTokens: 200000, availableInputTokens: 190000, estimatedInputTokens: 10000, usagePercent: 5, overBudget: false},
        },
      };

      const {lastFrame} = render(
        <StatusBar
          layoutMode="wide"
          session={session}
          cwd="/tmp/demo"
          modelAlias="sonnet"
          runState={{status: 'done'}}
        />,
      );

      const frame = lastFrame()!;
      // Should contain subtitle metadata
      expect(frame).toContain('sonnet');
      expect(frame).toContain('12345678…90ab');
      expect(frame).toContain('5 msgs');
      expect(frame).toContain('/tmp/demo');
      // Should NOT contain title (lightweight mode)
      expect(frame).not.toContain('Some title');
      // Should NOT contain border characters
      expect(frame).not.toContain('╭');
      expect(frame).not.toContain('╰');
    });

    it('should render only subtitle in minimal mode', () => {
      const session: SessionState = {
        sessionId: 'abcd1234',
        sessionStatus: 'ready',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const {lastFrame} = render(
        <StatusBar
          layoutMode="minimal"
          session={session}
          cwd="/tmp/demo"
          modelAlias="default"
          runState={{status: 'idle'}}
        />,
      );

      const frame = lastFrame()!;
      expect(frame).toContain('default');
      // Minimal: no path line
      expect(frame).not.toContain('/tmp/demo');
    });
  });

  describe('Transcript message style', () => {
    it('should render user messages with > prefix', () => {
      const messages = [new HumanMessage('hello world')];

      const {lastFrame} = render(
        <Transcript coreMessages={messages} notices={[]} />,
      );

      const frame = lastFrame()!;
      expect(frame).toContain('> hello world');
      // Should NOT use old "you" label
      expect(frame).not.toContain('you     ');
    });

    it('should render assistant messages without prefix', () => {
      const messages = [
        new HumanMessage('hello'),
        new AIMessage('Hi there!'),
      ];

      const {lastFrame} = render(
        <Transcript coreMessages={messages} notices={[]} />,
      );

      const frame = lastFrame()!;
      // Assistant message: no label, direct text
      expect(frame).toContain('Hi there!');
      // Should NOT use old "codara" label
      expect(frame).not.toContain('codara  ');
    });
  });

  describe('StaticWelcome', () => {
    it('should render welcome box in wide mode with Claude Code style', () => {
      const {lastFrame} = render(
        <StaticWelcome layoutMode="wide" cwd="/tmp/demo" modelAlias="sonnet" tip="Use /help to see commands" />,
      );

      const frame = lastFrame()!;
      expect(frame).toContain('Welcome to Codara');
      expect(frame).toContain('sonnet');
      expect(frame).toContain('/tmp/demo');
      expect(frame).toContain('/help for help');
      expect(frame).toContain('Tip: Use /help to see commands');
      // Should have round border
      expect(frame).toContain('╭');
      expect(frame).toContain('╰');
    });

    it('should render minimal welcome as single line', () => {
      const {lastFrame} = render(
        <StaticWelcome layoutMode="minimal" modelAlias="default" tip="Use /help" />,
      );

      const frame = lastFrame()!;
      expect(frame).toContain('Codara');
      expect(frame).toContain('default');
      expect(frame).toContain('/help for help');
    });
  });

  describe('deriveRecentSessions', () => {
    it('should derive recent sessions from SessionState array', () => {
      const now = Date.now();
      const sessions: SessionState[] = [
        {
          sessionId: 'sess-1',
          sessionStatus: 'ready',
          createdAt: new Date(now - 3600000).toISOString(),
          updatedAt: new Date(now - 1800000).toISOString(),
          metadata: {title: 'Task A', messageCount: 10, lastActivity: new Date(now - 1800000).toISOString()},
        },
        {
          sessionId: 'sess-2',
          sessionStatus: 'closed',
          createdAt: new Date(now - 86400000).toISOString(),
          updatedAt: new Date(now - 86400000).toISOString(),
          metadata: {messageCount: 3, lastActivity: new Date(now - 86400000).toISOString()},
        },
      ];

      const result = deriveRecentSessions(sessions, now);
      expect(result).toHaveLength(2);
      expect(result[0]!.title).toBe('Task A');
      expect(result[0]!.messageCount).toBe(10);
      expect(result[0]!.timeAgo).toBe('30m ago');
      expect(result[1]!.timeAgo).toBe('1d ago');
    });

    it('should limit to 5 sessions', () => {
      const now = Date.now();
      const sessions: SessionState[] = Array.from({length: 10}, (_, i) => ({
        sessionId: `sess-${i}`,
        sessionStatus: 'ready' as const,
        createdAt: new Date(now - i * 3600000).toISOString(),
        updatedAt: new Date(now - i * 3600000).toISOString(),
        metadata: {messageCount: i, lastActivity: new Date(now - i * 3600000).toISOString()},
      }));

      const result = deriveRecentSessions(sessions, now);
      expect(result).toHaveLength(5);
    });
  });

  describe('SessionPicker', () => {
    it('should render session list with selected highlight', () => {
      const sessions: SessionPickerItem[] = [
        {sessionId: 'sess-1', title: 'Fix bug', messageCount: 5, timeAgo: '1h ago', truncatedId: 'sess-1'},
        {sessionId: 'sess-2', title: 'Add feature', messageCount: 12, timeAgo: '2d ago', truncatedId: 'sess-2'},
      ];

      const {lastFrame} = render(
        <SessionPicker
          sessions={sessions}
          loading={false}
          selectedIndex={0}
          onMoveUp={() => {}}
          onMoveDown={() => {}}
          onSelect={() => {}}
          onCancel={() => {}}
        />,
      );

      const frame = lastFrame()!;
      expect(frame).toContain('Resume Session');
      expect(frame).toContain('Fix bug');
      expect(frame).toContain('Add feature');
      expect(frame).toContain('›');
      expect(frame).toContain('navigate');
    });

    it('should show loading state', () => {
      const {lastFrame} = render(
        <SessionPicker
          sessions={[]}
          loading={true}
          selectedIndex={0}
          onMoveUp={() => {}}
          onMoveDown={() => {}}
          onSelect={() => {}}
          onCancel={() => {}}
        />,
      );

      const frame = lastFrame()!;
      expect(frame).toContain('Loading sessions');
    });

    it('should show empty state', () => {
      const {lastFrame} = render(
        <SessionPicker
          sessions={[]}
          loading={false}
          selectedIndex={0}
          onMoveUp={() => {}}
          onMoveDown={() => {}}
          onSelect={() => {}}
          onCancel={() => {}}
        />,
      );

      const frame = lastFrame()!;
      expect(frame).toContain('No sessions found');
    });
  });

  describe('Tool result elapsed time', () => {
    it('should show elapsed time in tool result rendering', () => {
      const {lastFrame} = render(
        <Transcript
          coreMessages={[]}
          notices={[]}
          activeTurn={{
            id: 'turn-1',
            prompt: 'run it',
            response: '',
            responseRole: 'assistant',
          }}
          runtimeEvents={[
            {
              id: 'evt_bash_start',
              sessionId: 'session-1',
              timestamp: '2026-03-16T10:00:00.000Z',
              kind: 'tool',
              phase: 'start',
              status: 'running',
              label: 'Bash(git status)',
              detail: 'bash',
            },
            {
              id: 'evt_bash_end',
              sessionId: 'session-1',
              timestamp: '2026-03-16T10:00:00.250Z',
              kind: 'tool',
              phase: 'end',
              status: 'done',
              label: 'Bash completed',
              detail: 'On branch main\nnothing to commit',
              parentId: 'evt_bash_start',
            },
          ]}
        />,
      );

      const frame = lastFrame()!;
      expect(frame).toContain('250ms');
      expect(frame).toContain('Bash');
    });

    it('should show expand hint for truncated output', () => {
      const longOutput = Array.from({length: 20}, (_, i) => `line ${i + 1}`).join('\n');

      const {lastFrame} = render(
        <Transcript
          coreMessages={[]}
          notices={[]}
          activeTurn={{
            id: 'turn-2',
            prompt: 'list files',
            response: '',
            responseRole: 'assistant',
          }}
          runtimeEvents={[
            {
              id: 'evt_grep_start',
              sessionId: 'session-1',
              timestamp: '2026-03-16T10:00:00.000Z',
              kind: 'tool',
              phase: 'start',
              status: 'running',
              label: 'Grep(pattern)',
              detail: 'grep',
            },
            {
              id: 'evt_grep_end',
              sessionId: 'session-1',
              timestamp: '2026-03-16T10:00:01.000Z',
              kind: 'tool',
              phase: 'end',
              status: 'done',
              label: 'Grep completed',
              detail: longOutput,
              parentId: 'evt_grep_start',
            },
          ]}
        />,
      );

      const frame = lastFrame()!;
      expect(frame).toContain('ctrl+o to expand');
    });
  });

  describe('Task panel truncation', () => {
    it('should show at most five rows and a +N more overflow hint', () => {
      const tasks: ActiveSubagentRun[] = [
        {id: 'run-1', name: 'Explore: One', status: 'running', startedAt: 1, elapsed: 1000},
        {id: 'run-2', name: 'Explore: Two', status: 'paused', startedAt: 2, elapsed: 1000},
        {id: 'run-3', name: 'Explore: Three', status: 'error', startedAt: 3, elapsed: 1000},
        {id: 'run-4', name: 'Explore: Four', status: 'done', startedAt: 4, elapsed: 1000},
        {id: 'run-5', name: 'Explore: Five', status: 'done', startedAt: 5, elapsed: 1000},
      ];

      const {lastFrame} = render(
        <SubagentRunPanel
          runs={tasks}
          runningCount={1}
          pausedCount={1}
          doneCount={2}
          errorCount={1}
          hiddenCount={2}
        />,
      );

      const frame = lastFrame()!;
      expect(frame).toContain('Subagents (1 running, 1 paused, 2 done, 1 failed)');
      expect(frame).toContain('Explore: One');
      expect(frame).toContain('Explore: Five');
      expect(frame).toContain('+2 more');
    });
  });

  describe('Active transcript running task grouping', () => {
    it('does not render assistant narration while a running subagent block owns the foreground', () => {
      const items: TranscriptItem[] = [
        {
          id: 'active-subagent-run:run-1',
          role: 'agent',
          content: '⏺ Explore(Analyze README and package metadata)\nRunning (35s · 17 tool activities)',
          toolMeta: {
            toolName: 'Agent',
            displayName: 'Explore',
            icon: '⏺',
            args: 'Analyze README and package metadata',
            status: 'running',
            elapsed: '35s',
            summaryLine: 'Running (35s · 17 tool activities)',
          },
        },
        {
          id: 'assistant-child-report',
          role: 'assistant',
          content: 'src/cli 目录架构分析报告\n\n1. 目录结构\n- app/\n- components/',
        },
      ];
      const taskSummaries: ActiveSubagentRun[] = [
        {
          id: 'run-1',
          name: 'Explore: Analyze README and package metadata',
          status: 'running',
          startedAt: Date.parse('2026-03-16T00:00:00Z'),
          elapsed: 61000,
          toolUseCount: 17,
          totalTokens: 32345,
        },
      ];

      const {lastFrame} = render(<ActiveTranscript items={items} activeSubagentRuns={taskSummaries} />);

      const frame = lastFrame()!;
      expect(frame).toContain('Explore(Analyze README and package metadata)');
      expect(frame).not.toContain('src/cli 目录架构分析报告');
    });

    it('should group parallel running tasks into a single transcript block', () => {
      const items: TranscriptItem[] = [
        {
          id: 'task-1',
          role: 'agent',
          content: '⏺ Explore(Analyze README and package metadata)\nRunning (35s · 17 tool activities)',
          toolMeta: {
            toolName: 'Agent',
            displayName: 'Explore',
            icon: '⏺',
            args: 'Analyze README and package metadata',
            status: 'running',
            elapsed: '35s',
            summaryLine: 'Running (35s · 17 tool activities)',
            outputLines: ['Bash: Run test suite'],
            allOutputLines: ['Read: README.md', 'Bash: Run test suite'],
            totalOutputLines: 2,
          },
        },
        {
          id: 'task-2',
          role: 'agent',
          content: '⏺ Explore(Sync architecture docs)\nRunning (28s · 15 tool activities)',
          toolMeta: {
            toolName: 'Agent',
            displayName: 'Explore',
            icon: '⏺',
            args: 'Sync architecture docs',
            status: 'running',
            elapsed: '28s',
            summaryLine: 'Running (28s · 15 tool activities)',
            outputLines: ['Update: docs/architecture-next/01-global-architecture-overview.md'],
            allOutputLines: ['Read: docs/architecture-next/README.md', 'Update: docs/architecture-next/01-global-architecture-overview.md'],
            totalOutputLines: 2,
          },
        },
      ];

      const {lastFrame} = render(<ActiveTranscript items={items} />);

      const frame = lastFrame()!;
      expect(frame).not.toContain('Running 2 subagents');
      expect(frame).toContain('Explore(Analyze README and package metadata)');
      expect(frame).toContain('⎿ Running (17 tool activities · 35s)');
      expect(frame).not.toContain('Bash: Run test suite');
      expect(frame).toContain('Explore(Sync architecture docs)');
      expect(frame).toContain('⎿ Running (15 tool activities · 28s)');
      expect(frame).not.toContain('Update: docs/architecture-next/01-global-architecture-overview.md');
    });

    it('should render a single running task as a stable execution block without child activity detail', () => {
      const items: TranscriptItem[] = [
        {
          id: 'active-subagent-run:run-1',
          role: 'agent',
          content: '⏺ Explore(Analyze README and package metadata)\nRunning (35s · 17 tool activities)',
          toolMeta: {
            toolName: 'Agent',
            displayName: 'Explore',
            icon: '⏺',
            args: 'Analyze README and package metadata',
            status: 'running',
            elapsed: '35s',
            summaryLine: 'Running (35s · 17 tool activities)',
          },
        },
      ];
      const taskSummaries: ActiveSubagentRun[] = [
        {
          id: 'run-1',
          name: 'Explore: Analyze README and package metadata',
          status: 'running',
          startedAt: Date.parse('2026-03-16T00:00:00Z'),
          elapsed: 61000,
          detail: 'Bash: Run test suite',
          toolUseCount: 17,
          totalTokens: 32345,
        },
      ];

      const {lastFrame} = render(<ActiveTranscript items={items} activeSubagentRuns={taskSummaries} />);

      const frame = lastFrame()!;
      expect(frame).toContain('Explore(Analyze README and package metadata)');
      expect(frame).toContain('⎿ Running (17 tool uses · 32.3k tokens · 61s)');
      expect(frame).not.toContain('Bash: Run test suite');
      expect(frame).not.toContain('Running task');
      expect(frame).not.toContain('35s · 17 tool activities');
    });

    it('should fall back to runtime activity stats when live task summaries have no tool/token counts yet', () => {
      const items: TranscriptItem[] = [
        {
          id: 'active-subagent-run:run-fallback',
          role: 'agent',
          content: '⏺ Explore(Analyze README and package metadata)\nRunning (35s · 17 tool activities)',
          toolMeta: {
            toolName: 'Agent',
            displayName: 'Explore',
            icon: '⏺',
            args: 'Analyze README and package metadata',
            status: 'running',
            elapsed: '35s',
            summaryLine: 'Running (35s · 17 tool activities)',
          },
        },
      ];
      const taskSummaries: ActiveSubagentRun[] = [
        {
          id: 'run-fallback',
          name: 'Explore: Analyze README and package metadata',
          status: 'running',
          startedAt: Date.parse('2026-03-16T00:00:00Z'),
          elapsed: 12000,
          detail: 'glob(src/*)',
        },
      ];

      const {lastFrame} = render(<ActiveTranscript items={items} activeSubagentRuns={taskSummaries} />);

      const frame = lastFrame()!;
      expect(frame).toContain('Explore(Analyze README and package metadata)');
      expect(frame).toContain('⎿ Running (17 tool activities · 12s)');
      expect(frame).not.toContain('glob(src/*)');
    });

    it('should prefer live task detail over stale runtime activity lines', () => {
      const items: TranscriptItem[] = [
        {
          id: 'active-subagent-run:run-live-detail',
          role: 'agent',
          content: '⏺ Explore(Analyze README and package metadata)\nRunning (35s · 2 tool activities)',
          toolMeta: {
            toolName: 'Agent',
            displayName: 'Explore',
            icon: '⏺',
            args: 'Analyze README and package metadata',
            status: 'running',
            elapsed: '35s',
            summaryLine: 'Running (35s · 2 tool activities)',
            outputLines: ['read_file(README.md)'],
            allOutputLines: ['read_file(README.md)', 'read_file(package.json)'],
            totalOutputLines: 2,
          },
        },
      ];
      const taskSummaries: ActiveSubagentRun[] = [
        {
          id: 'run-live-detail',
          name: 'Explore: Analyze README and package metadata',
          status: 'running',
          startedAt: Date.parse('2026-03-16T00:00:00Z'),
          elapsed: 36000,
          detail: 'glob(src/**/*)',
        },
      ];

      const {lastFrame} = render(<ActiveTranscript items={items} activeSubagentRuns={taskSummaries} />);

      const frame = lastFrame()!;
      expect(frame).not.toContain('glob(src/**/*)');
      expect(frame).not.toContain('⎿ read_file(package.json)');
    });

    it('should render paused single-task blocks with the same execution header and a waiting summary', () => {
      const items: TranscriptItem[] = [
        {
          id: 'active-subagent-run:run-paused',
          role: 'agent',
          content: '⏺ Explore(Inspect guarded task)\nWaiting for review (53s)',
          toolMeta: {
            toolName: 'Agent',
            displayName: 'Explore',
            icon: '⏺',
            args: 'Inspect guarded task',
            status: 'running',
            elapsed: '53s',
            summaryLine: 'Waiting for review (53s)',
          },
        },
      ];
      const taskSummaries: ActiveSubagentRun[] = [
        {
          id: 'run-paused',
          name: 'Explore: Inspect guarded task',
          status: 'paused',
          startedAt: Date.parse('2026-03-16T00:00:00Z'),
          elapsed: 53000,
          detail: 'Waiting for approval on glob',
        },
      ];

      const {lastFrame} = render(<ActiveTranscript items={items} activeSubagentRuns={taskSummaries} />);

      const frame = lastFrame()!;
      expect(frame).toContain('Explore(Inspect guarded task)');
      expect(frame).toContain('⎿ Waiting for review (53s)');
      expect(frame).not.toContain('Waiting for approval on glob');
      expect(frame).not.toContain('Task waiting for review');
    });

    it('should render completed tasks using the original hierarchical task shape with a done summary line', () => {
      const items: TranscriptItem[] = [
        {
          id: 'active-subagent-run:run-done',
          role: 'agent',
          content: '⏺ Explore(Analyze README and package metadata)\nDone (38s)',
          toolMeta: {
            toolName: 'Agent',
            displayName: 'Explore',
            icon: '⏺',
            args: 'Analyze README and package metadata',
            status: 'done',
            elapsed: '38s',
            summaryLine: 'Done (38s)',
            outputLines: ['Read(package.json)'],
            allOutputLines: ['glob(README*)', 'Read(package.json)'],
            totalOutputLines: 2,
          },
        },
      ];

      const {lastFrame} = render(<ActiveTranscript items={items} />);

      const frame = lastFrame()!;
      expect(frame).toContain('⏺ Explore(Analyze README and package metadata)');
      expect(frame).toContain('⎿ Done (38s)');
      expect(frame).not.toContain('Read(package.json)');
      expect(frame).not.toContain('CHILD_DONE');
    });

    it('should switch a single task block to done when the live task summary has completed', () => {
      const {lastFrame} = render(<ActiveTranscript items={[{
        id: 'active-subagent-run:run-single-done',
        role: 'agent',
        content: '⏺ Explore(Analyze architecture)\nDone (2 tool uses · 14.4k tokens · 38s)',
        toolMeta: {
          toolName: 'Agent',
          displayName: 'Explore',
          icon: '⏺',
          args: 'Analyze architecture',
          status: 'done',
          summaryLine: 'Done (2 tool uses · 14.4k tokens · 38s)',
        },
      }]} />);

      const frame = lastFrame()!;
      expect(frame).toContain('⏺ Explore(Analyze architecture)');
      expect(frame).toContain('⎿ Done (2 tool uses · 14.4k tokens · 38s)');
      expect(frame).not.toContain('⎿ Running');
    });

    it('should keep completed execution blocks visible while sibling tasks continue running in parallel', () => {
      const {lastFrame} = render(
        <ActiveTranscript
          items={[
            {
              id: 'turn-mixed-task-states-prompt',
              role: 'user',
              content: 'analyze project',
            },
            {
              id: 'active-subagent-run:run-done',
              role: 'agent',
              content: '⏺ Explore(Analyze architecture)\nDone (2 tool uses · 14.4k tokens · 38s)',
              toolMeta: {
                toolName: 'Agent',
                displayName: 'Explore',
                icon: '⏺',
                args: 'Analyze architecture',
                status: 'done',
                summaryLine: 'Done (2 tool uses · 14.4k tokens · 38s)',
              },
            },
            {
              id: 'active-subagent-run:run-running',
              role: 'agent',
              content: '⏺ Explore(Analyze tech stack)\nRunning (1 tool uses · 12s)',
              toolMeta: {
                toolName: 'Agent',
                displayName: 'Explore',
                icon: '⏺',
                args: 'Analyze tech stack',
                status: 'running',
                summaryLine: 'Running (1 tool uses · 12s)',
              },
            },
          ]}
        />,
      );

      const frame = lastFrame()!;
      expect(frame).toContain('Explore(Analyze tech stack)');
      expect(frame).toContain('⎿ Running (1 tool uses · 12s)');
      expect(frame).toContain('⏺ Explore(Analyze architecture)');
      expect(frame).toContain('⎿ Done (2 tool uses · 14.4k tokens · 38s)');
    });

    it('should dedupe repeated subagent execution blocks that refer to the same completed runs', () => {
      const {lastFrame} = render(
        <ActiveTranscript
          items={[
            {
              id: 'active-subagent-run:run-cli',
              role: 'agent',
              content: '⏺ Explore(分析 `src/cli` 目录的架构和职责)\nDone (14 tool uses · 135.9k tokens · 2m21s)',
              toolMeta: {
                toolName: 'Agent',
                displayName: 'Explore',
                icon: '⏺',
                args: '分析 `src/cli` 目录的架构和职责',
                runId: 'run-cli',
                status: 'done',
                summaryLine: 'Done (14 tool uses · 135.9k tokens · 2m21s)',
              },
            },
            {
              id: 'tool-message:run-cli-result',
              role: 'agent',
              content: '⏺ Explore(分析 `src/cli` 目录的架构和职责)\nDone (14 tool uses · 135.9k tokens · 2m21s)',
              toolMeta: {
                toolName: 'Agent',
                displayName: 'Explore',
                icon: '⏺',
                args: '分析 `src/cli` 目录的架构和职责',
                runId: 'run-cli',
                status: 'done',
                summaryLine: 'Done (14 tool uses · 135.9k tokens · 2m21s)',
              },
            },
            {
              id: 'active-subagent-run:run-capability',
              role: 'agent',
              content: '⏺ Explore(分析 `src/capability` 目录的架构和职责)\nDone (17 tool uses · 132.5k tokens · 2m45s)',
              toolMeta: {
                toolName: 'Agent',
                displayName: 'Explore',
                icon: '⏺',
                args: '分析 `src/capability` 目录的架构和职责',
                runId: 'run-capability',
                status: 'done',
                summaryLine: 'Done (17 tool uses · 132.5k tokens · 2m45s)',
              },
            },
            {
              id: 'tool-message:run-capability-result',
              role: 'agent',
              content: '⏺ Explore(分析 `src/capability` 目录的架构和职责)\nDone (17 tool uses · 132.5k tokens · 2m45s)',
              toolMeta: {
                toolName: 'Agent',
                displayName: 'Explore',
                icon: '⏺',
                args: '分析 `src/capability` 目录的架构和职责',
                runId: 'run-capability',
                status: 'done',
                summaryLine: 'Done (17 tool uses · 132.5k tokens · 2m45s)',
              },
            },
          ]}
        />,
      );

      const frame = lastFrame()!;
      expect(frame).not.toContain('Completed 2 subagents');
      expect(frame).not.toContain('Completed 4 subagents');
      expect(frame.match(/Explore\(分析 `src\/cli` 目录的架构和职责\)/g)?.length).toBe(1);
      expect(frame.match(/Explore\(分析 `src\/capability` 目录的架构和职责\)/g)?.length).toBe(1);
    });

    it('should keep completed task blocks in the same execution-tree shape after they move into the solidified transcript', () => {
      const {lastFrame} = render(
        <SolidifiedBlock
          turn={{
            id: 'solid-turn-task-done',
            kind: 'turn',
            items: [
              {
                id: 'active-subagent-run:run-solid-done',
                role: 'agent',
                content: '⏺ Explore(Analyze architecture)\nDone (2 tool uses · 14.4k tokens · 38s)',
                toolMeta: {
                  toolName: 'Agent',
                  displayName: 'Explore',
                  icon: '⏺',
                  args: 'Analyze architecture',
                  status: 'done',
                  elapsed: '38s',
                  summaryLine: 'Done (2 tool uses · 14.4k tokens · 38s)',
                  outputLines: ['glob(vite.config.{ts,js})'],
                  allOutputLines: ['read_file(package.json)', 'glob(vite.config.{ts,js})'],
                  totalOutputLines: 2,
                },
              },
            ],
          }}
          layoutMode="compact"
          cwd="/Users/nako/WebstormProjects/github/thefoxfairy/Codara"
          modelAlias="default"
          tip="Tip"
        />,
      );

      const frame = lastFrame()!;
      expect(frame).toContain('⏺ Explore(Analyze architecture)');
      expect(frame).toContain('⎿ Done (2 tool uses · 14.4k tokens · 38s)');
      expect(frame).not.toContain('glob(vite.config.{ts,js})');
      expect(frame).not.toContain('⏺ Explore(Analyze architecture) (38s)');
    });

    it('should show only nested child tool history for a subagent block when global detailed mode is enabled', () => {
      const detailItems: TranscriptItem[] = [
        {
          id: 'child-tool-call',
          role: 'tool',
          content: '📖 Read(package.json)\n  ⎿ Read 42 lines',
          toolMeta: {
            toolName: 'Read',
            displayName: 'Read',
            icon: '📖',
            args: 'package.json',
            status: 'done',
            summaryLine: 'Read 42 lines',
            outputLines: ['  "name": "codara"'],
            allOutputLines: ['  "name": "codara"'],
            totalOutputLines: 1,
          },
        },
        {
          id: 'child-assistant',
          role: 'assistant',
          content: 'I inspected package metadata and noted the runtime entry points.',
        },
      ];

      const {lastFrame} = render(
        <ActiveTranscript
          expandedAll
          subagentDetails={new Map([['run-detailed', detailItems]])}
          items={[{
            id: 'active-subagent-run:run-detailed',
            role: 'agent',
            content: '⏺ Explore(Analyze architecture)\nDone (2 tool uses · 38s)',
            toolMeta: {
              toolName: 'Agent',
              displayName: 'Explore',
              icon: '⏺',
              args: 'Analyze architecture',
              runId: 'run-detailed',
              status: 'done',
              summaryLine: 'Done (2 tool uses · 38s)',
            },
          }]}
        />,
      );

      const frame = lastFrame()!;
      expect(frame).toContain('⏺ Explore(Analyze architecture)');
      expect(frame).toContain('📖 Read(package.json)');
      expect(frame).not.toContain('I inspected package metadata and noted the runtime entry points.');
    });

    it('should expand solidified subagent blocks using the same global detailed mode', () => {
      const detailItems: TranscriptItem[] = [{
        id: 'child-tool-call',
        role: 'tool',
        content: '📖 Read(src/index.ts)\n  ⎿ Read 81 lines',
        toolMeta: {
          toolName: 'Read',
          displayName: 'Read',
          icon: '📖',
          args: 'src/index.ts',
          status: 'done',
          summaryLine: 'Read 81 lines',
          outputLines: ['export * from "./codara";'],
          allOutputLines: ['export * from "./codara";'],
          totalOutputLines: 1,
        },
      }];

      const {lastFrame} = render(
        <SolidifiedBlock
          expandedAll
          subagentDetails={new Map([['run-solid-detail', detailItems]])}
          turn={{
            id: 'solid-turn-task-detail',
            kind: 'turn',
            items: [
              {
                id: 'active-subagent-run:run-solid-detail',
                role: 'agent',
                content: '⏺ Explore(Analyze index exports)\nDone (1 tool use · 18s)',
                toolMeta: {
                  toolName: 'Agent',
                  displayName: 'Explore',
                  icon: '⏺',
                  args: 'Analyze index exports',
                  runId: 'run-solid-detail',
                  status: 'done',
                  summaryLine: 'Done (1 tool use · 18s)',
                },
              },
            ],
          }}
          layoutMode="compact"
          cwd="/Users/nako/WebstormProjects/github/thefoxfairy/Codara"
          modelAlias="default"
          tip="Tip"
        />,
      );

      const frame = lastFrame()!;
      expect(frame).toContain('⏺ Explore(Analyze index exports)');
      expect(frame).toContain('📖 Read(src/index.ts)');
    });

    it('should not synthesize live subagent runs into the main transcript when no subagent block exists yet', () => {
      const items: TranscriptItem[] = [{
        id: 'turn-prompt',
        role: 'user',
        content: '请并行分析两个目录，然后汇总。',
      }];
      const activeSubagentRuns: ActiveSubagentRun[] = [
        {
          id: 'run-running',
          name: 'Explore: Analyze tech stack',
          status: 'running',
          startedAt: Date.now() - 12_000,
          elapsed: 12_000,
          detail: 'glob(vite.config.{ts,js})',
          toolUseCount: 1,
        },
        {
          id: 'run-done',
          name: 'Explore: Analyze architecture',
          status: 'done',
          startedAt: Date.now() - 38_000,
          endedAt: Date.now() - 1_000,
          elapsed: 38_000,
          detail: 'Codara is a terminal-first AI agent runtime.',
          toolUseCount: 2,
          totalTokens: 14_400,
        },
      ];

      const {lastFrame} = render(<ActiveTranscript items={items} activeSubagentRuns={activeSubagentRuns} />);

      const frame = lastFrame()!;
      expect(frame).toContain('请并行分析两个目录，然后汇总。');
      expect(frame).not.toContain('Running 2 subagents');
      expect(frame).not.toContain('Explore(Analyze tech stack)');
      expect(frame).not.toContain('Explore(Analyze architecture)');
    });

    it('should keep real completed subagent blocks ahead of the main continuation reply', () => {
      const items: TranscriptItem[] = [
        {
          id: 'turn-prompt',
          role: 'user',
          content: '请并行分析两个目录，然后汇总。',
        },
        {
          id: 'run-cli',
          role: 'agent',
          content: '⏺ Explore(分析 `src/cli` 目录，重点回答：)\nDone (25 tool uses · 270.9k tokens · 2m38s)',
          toolMeta: {
            toolName: 'Agent',
            displayName: 'Explore',
            icon: '⏺',
            args: '分析 `src/cli` 目录，重点回答：',
            runId: 'run-cli',
            status: 'done',
            summaryLine: 'Done (25 tool uses · 270.9k tokens · 2m38s)',
          },
        },
        {
          id: 'run-capability',
          role: 'agent',
          content: '⏺ Explore(分析 `src/capability` 目录，重点回答：)\nDone (21 tool uses · 156.6k tokens · 2m28s)',
          toolMeta: {
            toolName: 'Agent',
            displayName: 'Explore',
            icon: '⏺',
            args: '分析 `src/capability` 目录，重点回答：',
            runId: 'run-capability',
            status: 'done',
            summaryLine: 'Done (21 tool uses · 156.6k tokens · 2m28s)',
          },
        },
        {
          id: 'turn-response',
          role: 'assistant',
          content: '当前架构最核心的边界是 CLI 负责前台交互，capability 负责能力域封装。',
        },
      ];

      const {lastFrame} = render(<ActiveTranscript items={items} />);
      const frame = lastFrame()!;
      const cliRunIndex = frame.indexOf('Explore(分析 `src/cli` 目录，重点回答：)');
      const capabilityRunIndex = frame.indexOf('Explore(分析 `src/capability` 目录，重点回答：)');
      const replyIndex = frame.indexOf('当前架构最核心的边界是 CLI 负责前台交互');

      expect(cliRunIndex).toBeGreaterThan(-1);
      expect(capabilityRunIndex).toBeGreaterThan(-1);
      expect(replyIndex).toBeGreaterThan(-1);
      expect(cliRunIndex).toBeLessThan(replyIndex);
      expect(capabilityRunIndex).toBeLessThan(replyIndex);
    });

    it('should suppress assistant narration while any foreground subagent run is still active', () => {
      const items: TranscriptItem[] = [
        {
          id: 'turn-prompt',
          role: 'user',
          content: '请并行分析两个目录，然后汇总。',
        },
        {
          id: 'run-cli',
          role: 'agent',
          content: '⏺ Explore(分析 `src/cli` 目录)\nRunning (7 tool uses · 36s)',
          toolMeta: {
            toolName: 'Agent',
            displayName: 'Explore',
            icon: '⏺',
            args: '分析 `src/cli` 目录',
            runId: 'run-cli',
            status: 'running',
            summaryLine: 'Running (7 tool uses · 36s)',
          },
        },
        {
          id: 'leaked-child-text',
          role: 'assistant',
          content: 'src/cli 目录架构分析报告\n\n1. 目录结构\n\nsrc/cli/',
        },
      ];
      const activeSubagentRuns: ActiveSubagentRun[] = [{
        id: 'run-cli',
        name: 'Explore: 分析 `src/cli` 目录',
        status: 'running',
        startedAt: Date.now() - 36_000,
        elapsed: 36_000,
        toolUseCount: 7,
      }];

      const {lastFrame} = render(<ActiveTranscript items={items} activeSubagentRuns={activeSubagentRuns} />);
      const frame = lastFrame()!;

      expect(frame).toContain('请并行分析两个目录，然后汇总。');
      expect(frame).toContain('Explore(分析 `src/cli` 目录)');
      expect(frame).not.toContain('src/cli 目录架构分析报告');
    });
  });
});
