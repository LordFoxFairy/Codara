import {describe, expect, it} from 'bun:test';
import {describeFooter} from '../../../src/cli/components/chrome/footer';
import {describeHeader} from '../../../src/cli/components/chrome/header';
import type {CodaraRuntimeEvent, SessionState} from '@core';

describe('CLI chrome', () => {
  it('should keep the header compact and single-purpose', () => {
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

    const model = describeHeader({
      layoutMode: 'wide',
      session,
      modelAlias: 'sonnet',
      runState: {status: 'paused'},
      latestRuntimeEvent,
    });

    expect(model.title).toBe('Permission task');
    expect(model.subtitle).toContain('sonnet');
    expect(model.subtitle).toContain('12345678…90ab');
    expect(model.subtitle).toContain('12 msgs');
    expect(model.subtitle).toContain('6% ctx');
    expect(model.subtitle).toContain('waiting for review');
  });

  it('should keep the footer to a single compact hint line', () => {
    expect(describeFooter('wide')).toBe('Ctrl+C exit  ·  ? shortcuts  ·  tab thinking  ·  auto-update on');
    expect(describeFooter('minimal')).toBe('? shortcuts  ·  tab thinking  ·  auto-update on');
  });
});
