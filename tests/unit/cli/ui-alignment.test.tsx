import {describe, expect, it} from 'bun:test';
import {render} from 'ink-testing-library';
import {StatusBar} from '../../../src/cli/components/chrome/header';
import {ActiveTranscript, Transcript} from '../../../src/cli/components/conversation/transcript';
import {StaticWelcome, deriveRecentSessions} from '../../../src/cli/components/conversation/welcome-state';
import {SessionPicker} from '../../../src/cli/components/conversation/session-picker';
import {resolveCliForegroundSurface} from '../../../src/cli/app/shell-app';
import {HumanMessage, AIMessage} from '@langchain/core/messages';
import type {SessionState} from '@/index';
import type {SessionPickerItem} from '../../../src/cli/hooks/use-session-picker';
import type {ActiveTask} from '../../../src/cli/hooks/use-active-tasks';
import type {TranscriptItem} from '../../../src/cli/transcript/model';

describe('UI alignment with Claude Code', () => {
  describe('Welcome → Conversation transition', () => {
    it('should show welcome when no conversation', () => {
      expect(resolveCliForegroundSurface({hasHilReview: false, hasConversation: false})).toBe('welcome');
    });

    it('should show transcript when conversation exists', () => {
      expect(resolveCliForegroundSurface({hasHilReview: false, hasConversation: true})).toBe('transcript');
    });

    it('should show hil when review is active', () => {
      expect(resolveCliForegroundSurface({hasHilReview: true, hasConversation: true})).toBe('hil');
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

  describe('Active transcript running task grouping', () => {
    it('should group parallel running tasks into a single transcript block', () => {
      const items: TranscriptItem[] = [
        {
          id: 'task-1',
          role: 'task',
          content: '⚙ Explore(Analyze README and package metadata)\nRunning (35s · 17 tool activities)',
          toolMeta: {
            toolName: 'Task',
            displayName: 'Explore',
            icon: '⚙',
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
          role: 'task',
          content: '⚙ Explore(Sync architecture docs)\nRunning (28s · 15 tool activities)',
          toolMeta: {
            toolName: 'Task',
            displayName: 'Explore',
            icon: '⚙',
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
      expect(frame).toContain('Running 2 agents');
      expect(frame).toContain('Explore: Analyze README and package metadata · 17 tool activities');
      expect(frame).toContain('Explore: Sync architecture docs · 15 tool activities');
      expect(frame).toContain('⎿ Bash: Run test suite');
      expect(frame).toContain('Explore: Sync architecture docs · 15 tool activities');
      expect(frame).toContain('⎿ Update: docs/architecture-next/01-global-architecture-overview.md');
      expect(frame).not.toContain('⚙ Explore(Analyze README and package metadata)');
      expect(frame).not.toContain('⚙ Explore(Sync architecture docs)');
    });

    it('should render a single running task as a stable execution block with summary and latest activity', () => {
      const items: TranscriptItem[] = [
        {
          id: 'active-task-run:run-1',
          role: 'task',
          content: '⚙ Explore(Analyze README and package metadata)\nRunning (35s · 17 tool activities)',
          toolMeta: {
            toolName: 'Task',
            displayName: 'Explore',
            icon: '⚙',
            args: 'Analyze README and package metadata',
            status: 'running',
            elapsed: '35s',
            summaryLine: 'Running (35s · 17 tool activities)',
          },
        },
      ];
      const taskSummaries: ActiveTask[] = [
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

      const {lastFrame} = render(<ActiveTranscript items={items} activeTasks={taskSummaries} />);

      const frame = lastFrame()!;
      expect(frame).toContain('Explore(Analyze README and package metadata)');
      expect(frame).toContain('⎿ Running (17 tool uses · 32.3k tokens · 61s)');
      expect(frame).toContain('⎿ Bash: Run test suite');
      expect(frame).not.toContain('Running task');
      expect(frame).not.toContain('35s · 17 tool activities');
    });

    it('should fall back to runtime activity stats when live task summaries have no tool/token counts yet', () => {
      const items: TranscriptItem[] = [
        {
          id: 'active-task-run:run-fallback',
          role: 'task',
          content: '⚙ Explore(Analyze README and package metadata)\nRunning (35s · 17 tool activities)',
          toolMeta: {
            toolName: 'Task',
            displayName: 'Explore',
            icon: '⚙',
            args: 'Analyze README and package metadata',
            status: 'running',
            elapsed: '35s',
            summaryLine: 'Running (35s · 17 tool activities)',
          },
        },
      ];
      const taskSummaries: ActiveTask[] = [
        {
          id: 'run-fallback',
          name: 'Explore: Analyze README and package metadata',
          status: 'running',
          startedAt: Date.parse('2026-03-16T00:00:00Z'),
          elapsed: 12000,
          detail: 'glob(src/*)',
        },
      ];

      const {lastFrame} = render(<ActiveTranscript items={items} activeTasks={taskSummaries} />);

      const frame = lastFrame()!;
      expect(frame).toContain('Explore(Analyze README and package metadata)');
      expect(frame).toContain('⎿ Running (17 tool activities · 12s)');
      expect(frame).toContain('⎿ glob(src/*)');
    });

    it('should prefer live task detail over stale runtime activity lines', () => {
      const items: TranscriptItem[] = [
        {
          id: 'active-task-run:run-live-detail',
          role: 'task',
          content: '⚙ Explore(Analyze README and package metadata)\nRunning (35s · 2 tool activities)',
          toolMeta: {
            toolName: 'Task',
            displayName: 'Explore',
            icon: '⚙',
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
      const taskSummaries: ActiveTask[] = [
        {
          id: 'run-live-detail',
          name: 'Explore: Analyze README and package metadata',
          status: 'running',
          startedAt: Date.parse('2026-03-16T00:00:00Z'),
          elapsed: 36000,
          detail: 'glob(src/**/*)',
        },
      ];

      const {lastFrame} = render(<ActiveTranscript items={items} activeTasks={taskSummaries} />);

      const frame = lastFrame()!;
      expect(frame).toContain('⎿ glob(src/**/*)');
      expect(frame).not.toContain('⎿ read_file(package.json)');
    });

    it('should render paused single-task blocks with the same execution header and a waiting summary', () => {
      const items: TranscriptItem[] = [
        {
          id: 'active-task-run:run-paused',
          role: 'task',
          content: '⚙ Explore(Inspect guarded task)\nWaiting for review (53s)',
          toolMeta: {
            toolName: 'Task',
            displayName: 'Explore',
            icon: '⚙',
            args: 'Inspect guarded task',
            status: 'running',
            elapsed: '53s',
            summaryLine: 'Waiting for review (53s)',
          },
        },
      ];
      const taskSummaries: ActiveTask[] = [
        {
          id: 'run-paused',
          name: 'Explore: Inspect guarded task',
          status: 'paused',
          startedAt: Date.parse('2026-03-16T00:00:00Z'),
          elapsed: 53000,
          detail: 'Waiting for approval on glob',
        },
      ];

      const {lastFrame} = render(<ActiveTranscript items={items} activeTasks={taskSummaries} />);

      const frame = lastFrame()!;
      expect(frame).toContain('Explore(Inspect guarded task)');
      expect(frame).toContain('⎿ Waiting for review (53s)');
      expect(frame).toContain('⎿ Waiting for approval on glob');
      expect(frame).not.toContain('Task waiting for review');
    });

    it('should render completed tasks using the original hierarchical task shape with a done summary line', () => {
      const items: TranscriptItem[] = [
        {
          id: 'active-task-run:run-done',
          role: 'task',
          content: '⚙ Explore(Analyze README and package metadata)\nDone (38s)',
          toolMeta: {
            toolName: 'Task',
            displayName: 'Explore',
            icon: '⚙',
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
      expect(frame).toContain('⎿ Read(package.json)');
      expect(frame).not.toContain('CHILD_DONE');
    });
  });
});
