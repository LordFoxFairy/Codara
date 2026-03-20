import {describe, expect, it} from 'bun:test';
import {describeFooter} from '../../../src/cli/components/chrome/footer';
import {describeStatusBar} from '../../../src/cli/components/chrome/header';
import type {CodaraRuntimeEvent, SessionState} from '@/index';

describe('CLI chrome', () => {
  it('should keep the status bar compact and single-purpose', () => {
    const session: SessionState = {
      sessionId: '12345678-aaaa-bbbb-cccc-1234567890ab',
      sessionStatus: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        title: 'Permission task',
        messageCount: 12,
        lastActivity: new Date().toISOString(),
        contextWindow: {
          maxInputTokens: 200000,
          availableInputTokens: 180000,
          estimatedInputTokens: 12000,
          usagePercent: 6,
          overBudget: false,
        },
      },
    };
    const latestRuntimeEvent: CodaraRuntimeEvent = {
      id: 'evt-1',
      sessionId: session.sessionId,
      timestamp: new Date().toISOString(),
      kind: 'hil',
      phase: 'start',
      status: 'paused',
      label: 'Waiting for review',
    };

    const model = describeStatusBar({
      layoutMode: 'wide',
      session,
      cwd: '/tmp/codara-demo',
      modelAlias: 'sonnet',
      runState: {status: 'paused'},
      latestRuntimeEvent,
    });

    expect(model.subtitle).toContain('sonnet');
    expect(model.subtitle).toContain('12345678...90ab');
    expect(model.subtitle).toContain('12 msgs');
    expect(model.subtitle).toContain('6% ctx');
    expect(model.subtitle).toContain('waiting for review');
    expect(model.pathLine).toBe('/tmp/codara-demo');
  });

  it('should render token usage with arrow glyphs in wide mode', () => {
    const session: SessionState = {
      sessionId: '12345678-aaaa-bbbb-cccc-1234567890ab',
      sessionStatus: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        usage: {
          promptTokens: 143700,
          completionTokens: 3300,
          totalTokens: 147000,
        },
      },
    };

    const model = describeStatusBar({
      layoutMode: 'wide',
      session,
      cwd: '/tmp/codara-demo',
      modelAlias: 'default',
      runState: {status: 'idle'},
    });

    expect(model.subtitle).toContain('↑ 143.7k / ↓ 3.3k / 147.0k');
  });

  it('should show MCP indicator when all servers connected', () => {
    const session: SessionState = {
      sessionId: 'test-session',
      sessionStatus: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const model = describeStatusBar({
      layoutMode: 'wide',
      session,
      cwd: '/tmp',
      modelAlias: 'default',
      runState: {status: 'idle'},
      mcpStatus: {connected: 3, total: 3},
    });

    expect(model.subtitle).toContain('MCP:3');
    expect(model.subtitle).not.toContain('MCP:3/3');
  });

  it('should show MCP indicator with partial connections', () => {
    const session: SessionState = {
      sessionId: 'test-session',
      sessionStatus: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const model = describeStatusBar({
      layoutMode: 'wide',
      session,
      cwd: '/tmp',
      modelAlias: 'default',
      runState: {status: 'idle'},
      mcpStatus: {connected: 2, total: 3},
    });

    expect(model.subtitle).toContain('MCP:2/3');
  });

  it('should not show MCP indicator when no servers configured', () => {
    const session: SessionState = {
      sessionId: 'test-session',
      sessionStatus: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const model = describeStatusBar({
      layoutMode: 'wide',
      session,
      cwd: '/tmp',
      modelAlias: 'default',
      runState: {status: 'idle'},
    });

    expect(model.subtitle).not.toContain('MCP');
  });

  it('should keep the footer to a single compact hint line', () => {
    expect(describeFooter('wide')).toBe('Enter send | / commands | Ctrl+T tasks | Ctrl+O expand | Ctrl+C exit');
    expect(describeFooter('minimal')).toBe('Enter send | / commands | Ctrl+C exit');
  });
});
