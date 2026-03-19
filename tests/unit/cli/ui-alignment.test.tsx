import {describe, expect, it} from 'bun:test';
import {render} from 'ink-testing-library';
import {StatusBar} from '../../../src/cli/components/chrome/header';
import {Transcript} from '../../../src/cli/components/conversation/transcript';
import {StaticWelcome, deriveRecentSessions} from '../../../src/cli/components/conversation/welcome-state';
import {SessionPicker} from '../../../src/cli/components/conversation/session-picker';
import {resolveCliForegroundSurface} from '../../../src/cli/app/shell-app';
import {HumanMessage, AIMessage} from '@langchain/core/messages';
import type {SessionState} from '@/index';
import type {SessionPickerItem} from '../../../src/cli/hooks/use-session-picker';

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
      expect(frame).toContain('12345678...90ab');
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
});
