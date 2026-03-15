import {describe, expect, it} from 'bun:test';
import React from 'react';
import {render} from 'ink-testing-library';
import {StatusBar} from '../../../src/cli/components/chrome/header';
import {Transcript} from '../../../src/cli/components/conversation/transcript';
import {WelcomeState} from '../../../src/cli/components/conversation/welcome-state';
import {resolveCliForegroundSurface} from '../../../src/cli/app/shell-app';
import {HumanMessage, AIMessage} from '@langchain/core/messages';
import type {SessionState} from '@core';

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

  describe('WelcomeState', () => {
    it('should render welcome with RobotMark in wide mode', () => {
      const {lastFrame} = render(
        <WelcomeState layoutMode="wide" cwd="/tmp/demo" modelAlias="sonnet" />,
      );

      const frame = lastFrame()!;
      expect(frame).toContain('Welcome back!');
      expect(frame).toContain('sonnet');
      expect(frame).toContain('/tmp/demo');
    });

    it('should render minimal welcome as single line', () => {
      const {lastFrame} = render(
        <WelcomeState layoutMode="minimal" modelAlias="default" />,
      );

      const frame = lastFrame()!;
      expect(frame).toContain('Codara');
      expect(frame).toContain('default');
    });
  });
});
