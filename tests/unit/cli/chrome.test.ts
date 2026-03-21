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
    expect(model.subtitle).toContain('12345678');
    expect(model.subtitle).toContain('12 msgs');
    expect(model.subtitle).toContain('6% ctx');
    expect(model.subtitle.toLowerCase()).toContain('waiting');
    expect(model.pathLine).toBe('/tmp/codara-demo');
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
    expect(describeFooter('wide')).toBe('Enter send · Ctrl+C exit · / commands · Ctrl+T tasks · Ctrl+O expand');
    expect(describeFooter('minimal')).toBe('Enter send · ? shortcuts · Ctrl+C exit');
  });
});
