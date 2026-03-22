import {describe, expect, it} from 'bun:test';
import React, {useEffect} from 'react';
import {Text} from 'ink';
import {render} from 'ink-testing-library';
import {AIMessageChunk} from '@langchain/core/messages';
import type {
  Codara,
  CodaraStreamRequest,
  CodaraRuntimeEvent,
  FocusedReviewQuery,
  ReviewQueryItem,
  SessionState,
} from '@/index';
import type {ReviewRequest} from '@shared/contracts/agent-types';
import {useCliController} from '../../../src/cli/app/use-cli-controller';

describe('useCliController background refresh', () => {
  it('refreshes queued reviews when delegated-task review events arrive in the background', async () => {
    const codara = new FakeCodara();
    const rendered = render(<ControllerProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('reviewCount:0'));

      codara.setReviews([
        createReviewItem('approval-1', 'run-1', 'Approve alpha'),
        createReviewItem('approval-2', 'run-2', 'Approve beta'),
      ]);
      codara.emit({
        id: 'task-event-1',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'update',
        status: 'paused',
        label: 'Subagent waiting for review',
      });

      await waitFor(() => (rendered.lastFrame() ?? '').includes('reviewCount:2'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('reviewCount:2');
      expect(frame).toContain('reviewId:approval-1');
      expect(frame).toContain('latestNotice:none');
    } finally {
      rendered.unmount();
    }
  });

  it('does not surface detached child summaries directly when a background task completes after the foreground turn ends', async () => {
    const codara = new FakeCodara();
    const rendered = render(<ControllerProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('latestNotice:none'));

      codara.emit({
        id: 'task-event-complete',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'end',
        status: 'done',
        label: 'Subagent completed',
        detail: 'Found the project architecture summary',
      });

      await waitFor(() => (rendered.lastFrame() ?? '').includes('latestNotice:none'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).not.toContain('Found the');
      expect(frame).not.toContain('project architecture summary');
      expect(frame).not.toContain('Background task finished:');
      expect(frame).not.toContain('Background task completed');
    } finally {
      rendered.unmount();
    }
  });

  it('does not add an assistant-style follow-up after a background task completes', async () => {
    const codara = new FakeCodara();
    const rendered = render(<ControllerProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('latestAssistantNotice:none'));

      codara.emit({
        id: 'task-event-followup',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'end',
        status: 'done',
        label: 'Subagent completed',
        detail: 'Codara is a terminal-first AI agent runtime.',
      });

      await waitFor(() => (rendered.lastFrame() ?? '').includes('latestAssistantNotice:none'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).not.toContain('terminal-first AI agent runtime');
    } finally {
      rendered.unmount();
    }
  });

  it('does not add a child follow-up while sibling tasks in the same session are still active', async () => {
    const codara = new FakeCodara();
    codara.setAgentRunSummaries([
      {
        runId: 'run-done',
        parentSessionId: 'session-1',
        label: 'Delegating Explore: Analyze the tech stack',
        agentName: 'Explore',
        status: 'completed',
        startedAt: new Date(Date.now() - 10_000).toISOString(),
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      },
      {
        runId: 'run-still-running',
        parentSessionId: 'session-1',
        label: 'Delegating Explore: Analyze the project structure',
        agentName: 'Explore',
        status: 'running',
        startedAt: new Date(Date.now() - 8_000).toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    const rendered = render(<ControllerProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('latestAssistantNotice:none'));

      codara.emit({
        id: 'task-event-followup-with-sibling',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'end',
        status: 'done',
        label: 'Subagent completed',
        detail: 'Tech stack child summary',
        parentId: 'agent-run:run-done',
      });

      await waitFor(() => (rendered.lastFrame() ?? '').includes('latestAssistantNotice:none'));
      expect(rendered.lastFrame() ?? '').not.toContain('Tech stack child summary');
    } finally {
      rendered.unmount();
    }
  });

  it('does not re-enter the main agent while sibling tasks in the same session are paused for review', async () => {
    const codara = new FakeCodara();
    codara.blockNextStream();
    const rendered = render(<BackgroundFollowupProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:running'));

      codara.setAgentRunSummaries([
        {
          runId: 'run-done',
          parentSessionId: 'session-1',
          label: 'Delegating Explore: Analyze the tech stack',
          agentName: 'Explore',
          status: 'completed',
          startedAt: new Date(Date.now() - 10_000).toISOString(),
          updatedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          summary: 'Tech stack child summary',
        },
        {
          runId: 'run-paused',
          parentSessionId: 'session-1',
          label: 'Delegating Explore: Analyze the architecture',
          agentName: 'Explore',
          status: 'paused',
          startedAt: new Date(Date.now() - 8_000).toISOString(),
          updatedAt: new Date().toISOString(),
          summary: 'Architecture child summary',
        },
      ]);
      codara.emit({
        id: 'agent-run:run-done',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'start',
        status: 'running',
        label: 'Delegating Explore: Analyze the tech stack',
      });
      codara.emit({
        id: 'agent-run:run-paused',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'start',
        status: 'running',
        label: 'Delegating Explore: Analyze the architecture',
      });

      codara.releaseBlockedStream();
      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:done'));

      codara.emit({
        id: 'task-event-followup-with-paused-sibling',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'end',
        status: 'done',
        label: 'Subagent completed',
        detail: 'Tech stack child summary',
        parentId: 'agent-run:run-done',
      });

      await waitFor(() => (rendered.lastFrame() ?? '').includes('streamCalls:1'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('latestAssistantNotice:none');
      expect(frame).toContain('streamCalls:1');
      expect(frame).not.toContain('Tech stack child summary');
    } finally {
      codara.releaseBlockedStream();
      rendered.unmount();
    }
  });

  it('re-enters the main agent after the tracked task batch completes instead of surfacing child summaries directly', async () => {
    const codara = new FakeCodara();
    codara.blockNextStream();
    codara.queueStreamText('Unified final answer from the main agent.');
    const rendered = render(<BackgroundFollowupProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:running'));

      codara.setAgentRunSummaries([
        {
          runId: 'run-tech',
          parentSessionId: 'session-1',
          label: 'Delegating Explore: Analyze the tech stack',
          agentName: 'Explore',
          status: 'running',
          startedAt: new Date(Date.now() - 10_000).toISOString(),
          updatedAt: new Date().toISOString(),
          summary: 'Tech stack child summary',
          toolUseCount: 4,
          totalTokens: 1200,
        },
        {
          runId: 'run-structure',
          parentSessionId: 'session-1',
          label: 'Delegating Explore: Analyze the project structure',
          agentName: 'Explore',
          status: 'running',
          startedAt: new Date(Date.now() - 8_000).toISOString(),
          updatedAt: new Date().toISOString(),
          summary: 'Structure child summary',
          toolUseCount: 5,
          totalTokens: 1800,
        },
      ]);
      codara.emit({
        id: 'agent-run:run-tech',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'start',
        status: 'running',
        label: 'Delegating Explore: Analyze the tech stack',
      });
      codara.emit({
        id: 'agent-run:run-structure',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'start',
        status: 'running',
        label: 'Delegating Explore: Analyze the project structure',
      });

      codara.releaseBlockedStream();
      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:done'));

      codara.setAgentRunSummaries([
        {
          runId: 'run-tech',
          parentSessionId: 'session-1',
          label: 'Delegating Explore: Analyze the tech stack',
          agentName: 'Explore',
          status: 'completed',
          startedAt: new Date(Date.now() - 10_000).toISOString(),
          updatedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          summary: 'Tech stack child summary',
          toolUseCount: 4,
          totalTokens: 1200,
        },
        {
          runId: 'run-structure',
          parentSessionId: 'session-1',
          label: 'Delegating Explore: Analyze the project structure',
          agentName: 'Explore',
          status: 'completed',
          startedAt: new Date(Date.now() - 8_000).toISOString(),
          updatedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          summary: 'Structure child summary',
          toolUseCount: 5,
          totalTokens: 1800,
        },
      ]);
      codara.emit({
        id: 'task-event-batch-complete',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'end',
        status: 'done',
        label: 'Subagent completed',
        detail: 'Structure child summary',
        parentId: 'agent-run:run-structure',
      });

      await waitFor(() => codara.getStreamCallCount() === 2);
      await waitFor(() => (rendered.lastFrame() ?? '').includes('streamCalls:2'));
      const continuationCall = codara.getStreamCalls()[1];
      expect(continuationCall).toEqual(expect.objectContaining({
        kind: 'continuation',
        config: {
          streamMode: 'messages',
        },
        context: {
          codaraAgentCompletion: {
            runs: [
              expect.objectContaining({
                runId: 'run-tech',
                summary: 'Tech stack child summary',
              }),
              expect.objectContaining({
                runId: 'run-structure',
                summary: 'Structure child summary',
              }),
            ],
          },
        },
      }));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('streamCalls:2');
      expect(frame).toContain('latestAssistantNotice:none');
      expect(frame).not.toContain('Structure child summary');
    } finally {
      codara.releaseBlockedStream();
      rendered.unmount();
    }
  });

  it('does not re-enter the main agent until all pending parallel task placeholders have been satisfied by terminal runs', async () => {
    const codara = new FakeCodara();
    codara.blockNextStream();
    const rendered = render(<BackgroundFollowupProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:running'));

      codara.emit({
        id: 'pending-task-1',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'start',
        status: 'running',
        label: 'Delegating Explore: Analyze project positioning',
        detail: 'pending',
        parentId: 'turn-root-1',
      });
      codara.emit({
        id: 'pending-task-2',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'start',
        status: 'running',
        label: 'Delegating Explore: Analyze tech stack',
        detail: 'pending',
        parentId: 'turn-root-1',
      });
      codara.emit({
        id: 'pending-task-3',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'start',
        status: 'running',
        label: 'Delegating Explore: Analyze architecture',
        detail: 'pending',
        parentId: 'turn-root-1',
      });

      codara.setAgentRunSummaries([
        {
          runId: 'run-tech',
          parentSessionId: 'session-1',
          label: 'Delegating Explore: Analyze tech stack',
          agentName: 'Explore',
          status: 'completed',
          startedAt: new Date(Date.now() - 10_000).toISOString(),
          updatedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          summary: 'Tech stack summary',
        },
      ]);
      codara.emit({
        id: 'agent-run:run-tech',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'start',
        status: 'running',
        label: 'Delegating Explore: Analyze tech stack',
      });

      codara.releaseBlockedStream();
      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:done'));

      codara.emit({
        id: 'task-end-run-tech',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'end',
        status: 'done',
        label: 'Subagent completed',
        detail: 'Tech stack summary',
        parentId: 'agent-run:run-tech',
      });

      await waitFor(() => (rendered.lastFrame() ?? '').includes('streamCalls:1'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('streamCalls:1');
      expect(frame).toContain('latestAssistantNotice:none');
      expect(frame).not.toContain('Tech stack summary');
    } finally {
      codara.releaseBlockedStream();
      rendered.unmount();
    }
  });

  it('does not add a generic assistant follow-up when a background task completes without detail', async () => {
    const codara = new FakeCodara();
    const rendered = render(<ControllerProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('latestAssistantNotice:none'));

      codara.emit({
        id: 'task-event-empty-followup',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'end',
        status: 'done',
        label: 'Subagent completed',
      });

      await waitFor(() => (rendered.lastFrame() ?? '').includes('latestNotice:none'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('latestAssistantNotice:none');
      expect(frame).not.toContain('Task finished.');
    } finally {
      rendered.unmount();
    }
  });

  it('does not queue a fake assistant follow-up when a detached task completes before the parent turn fully settles', async () => {
    const codara = new FakeCodara();
    codara.blockNextStream();
    const rendered = render(<BackgroundFollowupProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:running'));
      codara.emit({
        id: 'task-event-early-followup',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'end',
        status: 'done',
        label: 'Subagent completed',
        detail: 'Queued child summary',
      });

      expect(rendered.lastFrame() ?? '').toContain('latestAssistantNotice:none');

      codara.releaseBlockedStream();

      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:done'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('runState:done');
      expect(frame).toContain('latestAssistantNotice:none');
      expect(frame).not.toContain('Queued child summary');
    } finally {
      codara.releaseBlockedStream();
      rendered.unmount();
    }
  });

  it('surfaces delegated-task review immediately even while the parent turn is still marked running', async () => {
    const codara = new FakeCodara();
    codara.blockNextStream();
    const rendered = render(<BackgroundReviewProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:running'));
      codara.setReviews([
        createReviewItem('approval-review', 'run-review', 'Waiting for approval on glob'),
      ]);
      codara.emit({
        id: 'task-event-review',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'agent',
        phase: 'update',
        status: 'paused',
        label: 'Subagent waiting for review',
        detail: 'Waiting for approval on glob',
        parentId: 'agent-run:run-review',
      });

      await waitFor(() => (rendered.lastFrame() ?? '').includes('review:approval-review'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('runState:paused');
      expect(frame).toContain('desc:Waiting for approval on glob');
    } finally {
      codara.releaseBlockedStream();
      rendered.unmount();
    }
  });

  it('advances to the next queued approval after the current approval is submitted', async () => {
    const codara = new FakeCodara();
    codara.blockNextResumeApproval();
    codara.setReviews([
      createReviewItem('approval-1', 'run-1', 'Waiting for approval on glob'),
      createReviewItem('approval-2', 'run-2', 'Waiting for approval on read_file'),
    ]);
    const rendered = render(<ReviewQueueProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('busy:true'));
      const busyFrame = rendered.lastFrame() ?? '';
      expect(busyFrame).toContain('reviewCount:2');
      expect(busyFrame).toContain('reviewId:approval-1');
      expect(busyFrame).toContain('busy:true');
      expect(busyFrame).toContain('resumeCount:1');

      codara.releaseBlockedResumeApproval();
      await waitFor(() => (rendered.lastFrame() ?? '').includes('reviewId:approval-2'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('reviewCount:1');
      expect(frame).toContain('reviewId:approval-2');
      expect(frame).toContain('resumeCount:1');
    } finally {
      rendered.unmount();
    }
  });

  it('dismisses a single permission approval immediately after submit while the subagent run keeps running in the background', async () => {
    const codara = new FakeCodara();
    codara.blockNextResumeApproval();
    codara.setReviews([
      createReviewItem('approval-1', 'run-1', 'Waiting for approval on read_file'),
    ]);
    const rendered = render(<SingleReviewProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('resumeCount:1'));
      await waitFor(() => (rendered.lastFrame() ?? '').includes('reviewId:none'));
      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:running'));
      const runningFrame = rendered.lastFrame() ?? '';
      expect(runningFrame).toContain('reviewId:none');
      expect(runningFrame).toContain('runState:running');
      expect(runningFrame).toContain('resumeCount:1');

      codara.releaseBlockedResumeApproval();
      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:done'));
      const settledFrame = rendered.lastFrame() ?? '';
      expect(settledFrame).toContain('reviewId:none');
      expect(settledFrame).toContain('runState:done');
      expect(settledFrame).toContain('resumeCount:1');
    } finally {
      codara.releaseBlockedResumeApproval();
      rendered.unmount();
    }
  });

  it('activates the highlighted AskUser option without auto-advancing the questionnaire', async () => {
    const codara = new FakeCodara();
    codara.setReviewRequest(createAskUserReviewRequest());
    const rendered = render(<ReviewSubmitProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('focus:input'));
      await waitFor(() => (rendered.lastFrame() ?? '').includes('answer:Python'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('answer:Python');
      expect(frame).toContain('activeTab:0');
      expect(frame).toContain('resumeCount:0');
    } finally {
      rendered.unmount();
    }
  });

  it('keeps unanswered AskUser steps on the current question when Next is activated', async () => {
    const codara = new FakeCodara();
    codara.setReviewRequest(createAskUserReviewRequest());
    const rendered = render(<ReviewNextProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('validation:Complete Language before continuing.'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('focus:actions');
      expect(frame).toContain('activeTab:0');
      expect(frame).toContain('resumeCount:0');
      expect(frame).toContain('validation:Complete Language before continuing.');
    } finally {
      rendered.unmount();
    }
  });

  it('does not turn a highlighted preset option into a custom answer when typing before Type something is selected', async () => {
    const codara = new FakeCodara();
    codara.setReviewRequest(createAskUserReviewRequest());
    const rendered = render(<ReviewCustomTypingProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('selectedIndex:0'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('selectedIndex:0');
      expect(frame).toContain('customInputActive:false');
      expect(frame).toContain('draft:');
      expect(frame).toContain('answer:none');
    } finally {
      rendered.unmount();
    }
  });

  it('lets numeric shortcuts switch away from the custom row after option 5 is selected', async () => {
    const codara = new FakeCodara();
    codara.setReviewRequest(createAskUserReviewRequest());
    const rendered = render(<ReviewCustomShortcutProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('answer:Python'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('selectedIndex:0');
      expect(frame).toContain('customInputActive:false');
      expect(frame).toContain('answer:Python');
      expect(frame).toContain('draft:Python');
    } finally {
      rendered.unmount();
    }
  });

  it('keeps multiselect custom focus empty after selecting a preset option, then allows switching back to another preset', async () => {
    const codara = new FakeCodara();
    codara.setReviewRequest(createMultiselectAskUserReviewRequest());
    const rendered = render(<ReviewMultiselectCustomProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('answer:["独立开发者","开发团队"]'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('selectedIndex:1');
      expect(frame).toContain('customInputActive:false');
      expect(frame).toContain('draft:独立开发者, 开发团队');
      expect(frame).toContain('answer:["独立开发者","开发团队"]');
    } finally {
      rendered.unmount();
    }
  });

  it('keeps prompt input as the active target for task-scoped reviews', async () => {
    const codara = new FakeCodara();
    codara.setReviews([
      createReviewItem('approval-1', 'run-1', 'Waiting for approval on glob'),
    ]);
    const rendered = render(<ReviewInputTargetProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('blockingScope:task'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('reviewId:approval-1');
      expect(frame).toContain('blockingScope:task');
      expect(frame).toContain('focusedSurface:prompt');
    } finally {
      rendered.unmount();
    }
  });

  it('switches to review input for session-scoped pauses', async () => {
    const codara = new FakeCodara();
    codara.setReviewRequest(createAskUserReviewRequest());
    const rendered = render(<ReviewInputTargetProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('blockingScope:session'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('reviewId:ask-user-pause');
      expect(frame).toContain('blockingScope:session');
      expect(frame).toContain('focusedSurface:review');
    } finally {
      rendered.unmount();
    }
  });

  it('waits for a foreground AskUser pause to settle before submitting the final review action', async () => {
    const codara = new FakeCodara();
    codara.setReviewRequest(createAskUserReviewRequest());
    codara.setHydrateSequence([
      {
        status: 'running',
        pendingReview: createAskUserReviewRequest(),
      },
      {
        status: 'paused',
        pendingReview: createAskUserReviewRequest(),
      },
      {
        status: 'idle',
        pendingReview: undefined,
      },
    ]);
    codara.failResumePauseWhileRunning();
    const rendered = render(<FinalAskUserSubmitProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('resumeCount:1'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('resumeCount:1');
      expect(frame).toContain('runState:done');
      expect(frame).toContain('error:none');
    } finally {
      rendered.unmount();
    }
  });

  it('keeps the completed AskUser review dismissed while runtime removal settles after Submit answers', async () => {
    const codara = new FakeCodara();
    codara.setFocusedReviewRequest(
      {
        ...createReviewItem('ask-user-pause', 'run-ask-user', 'Clarify the request'),
        kind: 'ask_user',
        interactionMode: 'structured',
        blockingScope: 'session',
      },
      createAskUserReviewRequest(),
    );
    codara.deferCurrentReviewRemovalOnResume(1);
    const rendered = render(<FinalAskUserSubmitProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('resumeCount:1'));
      await waitFor(() => (rendered.lastFrame() ?? '').includes('review:none'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('resumeCount:1');
      expect(frame).toContain('runState:done');
      expect(frame).toContain('review:none');
      expect(frame).toContain('activeTab:-1');
    } finally {
      rendered.unmount();
    }
  });

  it('keeps a running state visible while the final AskUser submit is still resuming', async () => {
    const codara = new FakeCodara();
    const reviewRequest = createAskUserReviewRequest();
    codara.setFocusedReviewRequest(
      {
        reviewId: reviewRequest.id,
        source: 'session_pause',
        kind: 'ask_user',
        interactionMode: 'structured',
        blockingScope: 'session',
        description: reviewRequest.description,
        toolName: reviewRequest.action.toolName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        anchor: {origin: 'main'},
        isFocused: true,
      },
      reviewRequest,
    );
    codara.blockNextResumeApproval();
    const rendered = render(<FinalAskUserSubmitProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('resumeCount:1'));
      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:running'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('runState:running');
      expect(frame).toContain('review:none');

      codara.releaseBlockedResumeApproval();

      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:done'));
    } finally {
      codara.releaseBlockedResumeApproval();
      rendered.unmount();
    }
  });

  it('queues a new session prompt submitted while the current stream is still running and drains it after settle', async () => {
    const codara = new FakeCodara();
    codara.blockNextStream();
    codara.queueStreamText('First response');
    codara.queueStreamText('Second response');
    const rendered = render(<QueuedPromptProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:running'));
      await waitFor(() => codara.getStreamCallCount() === 1);

      codara.releaseBlockedStream();

      await waitFor(() => codara.getStreamCallCount() === 2);
      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:done'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('streamCalls:2');
    } finally {
      codara.releaseBlockedStream();
      rendered.unmount();
    }
  });

  it('queues a task-scoped review response submitted while another stream is still running and drains it after settle', async () => {
    const codara = new FakeCodara();
    codara.blockNextStream();
    codara.queueStreamText('Foreground response');
    codara.setReviews([
      createReviewItem('approval-queued', 'run-queued', 'Approve queued review'),
    ]);
    const rendered = render(<QueuedReviewResponseProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:running'));
      await waitFor(() => codara.getStreamCallCount() === 1);

      codara.releaseBlockedStream();

      await waitFor(() => (rendered.lastFrame() ?? '').includes('resumeCount:1'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('resumeCount:1');
    } finally {
      codara.releaseBlockedStream();
      rendered.unmount();
    }
  });

  it('replays review auto actions after the foreground run settles while the same review stays focused', async () => {
    const codara = new FakeCodara();
    codara.blockNextStream();
    codara.queueStreamText('Foreground response');
    codara.setReviews([
      createReviewItem('approval-auto', 'run-auto', 'Approve auto review'),
    ]);
    const rendered = render(<ReviewAutoActionProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:running'));
      await waitFor(() => codara.getStreamCallCount() === 1);
      expect(rendered.lastFrame() ?? '').toContain('resumeCount:0');

      codara.releaseBlockedStream();

      await waitFor(() => (rendered.lastFrame() ?? '').includes('resumeCount:1'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('runState:done');
      expect(frame).toContain('review:none');
      expect(frame).toContain('streamCalls:2');
    } finally {
      codara.releaseBlockedStream();
      rendered.unmount();
    }
  });
});

function ControllerProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({codara});

  return (
    <Text>
      {`reviewCount:${controller.review?.reviewCount ?? 0}`}
      {` reviewId:${controller.review?.request.id ?? 'none'}`}
      {` latestNotice:${controller.notices[controller.notices.length - 1]?.content ?? 'none'}`}
      {` latestAssistantNotice:${[...controller.notices].reverse().find((notice) => notice.level === 'assistant')?.content ?? 'none'}`}
    </Text>
  );
}

function ReviewSubmitProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({codara});
  const firedRef = React.useRef(false);

  useEffect(() => {
    if (!controller.review || firedRef.current) {
      return;
    }
    firedRef.current = true;
    controller.submitReviewAction();
  }, [controller]);

  return (
    <Text>
      {`focus:${controller.review?.focus ?? 'none'}`}
      {` activeTab:${controller.review?.form?.activeTabIndex ?? -1}`}
      {` answer:${String(controller.review?.form?.answers.language ?? '')}`}
      {` resumeCount:${(codara as unknown as FakeCodara).resumeCount}`}
    </Text>
  );
}

function ReviewNextProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({codara});
  const focusToggledRef = React.useRef(false);
  const submittedRef = React.useRef(false);

  useEffect(() => {
    if (!controller.review || focusToggledRef.current) {
      return;
    }
    focusToggledRef.current = true;
    controller.toggleReviewFocus();
  }, [controller]);

  useEffect(() => {
    if (!controller.review || submittedRef.current || controller.review.focus !== 'actions') {
      return;
    }
    submittedRef.current = true;
    controller.submitReviewAction();
  }, [controller]);

  return (
    <Text>
      {`focus:${controller.review?.focus ?? 'none'}`}
      {` activeTab:${controller.review?.form?.activeTabIndex ?? -1}`}
      {` validation:${controller.review?.validationMessage ?? 'none'}`}
      {` resumeCount:${(codara as unknown as FakeCodara).resumeCount}`}
    </Text>
  );
}

function BackgroundReviewProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({codara});
  const firedRef = React.useRef(false);

  useEffect(() => {
    if (firedRef.current) {
      return;
    }
    firedRef.current = true;
    controller.submitText('delegate the guarded task');
  }, [controller]);

  return (
    <Text>
      {`runState:${controller.runState.status}`}
      {` review:${controller.review?.request.id ?? 'none'}`}
      {` desc:${controller.review?.request.description ?? 'none'}`}
    </Text>
  );
}

function ReviewInputTargetProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({codara});

  return (
    <Text>
      {`reviewId:${controller.review?.request.id ?? 'none'}`}
      {` blockingScope:${controller.review?.blockingScope ?? 'none'}`}
      {` focusedSurface:${controller.interactionState.focusedSurface}`}
    </Text>
  );
}

function FinalAskUserSubmitProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({codara});
  const stepRef = React.useRef(0);

  useEffect(() => {
    if (!controller.review) {
      return;
    }
    if (stepRef.current === 0 && controller.review.focus === 'input' && controller.review.form?.activeTabIndex === 0) {
      stepRef.current = 1;
      controller.insertReviewText('1');
      return;
    }
    if (stepRef.current === 1 && controller.review.form?.answers.language === 'Python') {
      stepRef.current = 2;
      controller.toggleReviewFocus();
      return;
    }
    if (stepRef.current === 2 && controller.review.focus === 'actions') {
      stepRef.current = 3;
      controller.submitReviewAction();
      return;
    }
    if (stepRef.current === 3 && controller.review.focus === 'input' && controller.review.form?.activeTabIndex === 1) {
      stepRef.current = 4;
      controller.insertReviewText('1');
      return;
    }
    if (stepRef.current === 4 && controller.review.form?.answers.complexity === 'Simple') {
      stepRef.current = 5;
      controller.toggleReviewFocus();
      return;
    }
    if (stepRef.current === 5 && controller.review.focus === 'actions' && !controller.review.form?.endStep) {
      stepRef.current = 6;
      controller.submitReviewAction();
      return;
    }
    if (stepRef.current === 6 && controller.review.form?.endStep && controller.review.focus === 'actions') {
      stepRef.current = 7;
      controller.submitReviewAction();
    }
  }, [controller]);

  return (
    <Text>
      {`runState:${controller.runState.status}`}
      {` error:${controller.runState.error ?? 'none'}`}
      {` resumeCount:${(codara as unknown as FakeCodara).resumeCount}`}
      {` review:${controller.review?.request.id ?? 'none'}`}
      {` activeTab:${controller.review?.form?.activeTabIndex ?? -1}`}
    </Text>
  );
}

function ReviewCustomTypingProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({codara});
  const firedRef = React.useRef(false);

  useEffect(() => {
    if (!controller.review || firedRef.current) {
      return;
    }
    firedRef.current = true;
    controller.insertReviewText('x');
  }, [controller]);

  return (
    <Text>
      {`selectedIndex:${controller.review?.selectedActionIndex ?? -1}`}
      {` customInputActive:${controller.review?.customInputActive ? 'true' : 'false'}`}
      {` draft:${controller.review?.draft ?? ''}`}
      {` answer:${String(controller.review?.form?.answers.language ?? 'none')}`}
    </Text>
  );
}

function ReviewCustomShortcutProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({codara});
  const stepRef = React.useRef(0);

  useEffect(() => {
    if (!controller.review) {
      return;
    }
    if (stepRef.current === 0) {
      stepRef.current = 1;
      controller.insertReviewText('3');
      return;
    }
    if (stepRef.current === 1 && controller.review.customInputActive) {
      stepRef.current = 2;
      controller.insertReviewText('1');
    }
  }, [controller]);

  return (
    <Text>
      {`selectedIndex:${controller.review?.selectedActionIndex ?? -1}`}
      {` customInputActive:${controller.review?.customInputActive ? 'true' : 'false'}`}
      {` draft:${controller.review?.draft ?? ''}`}
      {` answer:${String(controller.review?.form?.answers.language ?? 'none')}`}
    </Text>
  );
}

function ReviewMultiselectCustomProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({codara});
  const stepRef = React.useRef(0);

  useEffect(() => {
    if (!controller.review) {
      return;
    }
    if (stepRef.current === 0) {
      stepRef.current = 1;
      controller.insertReviewText('1');
      return;
    }
    if (stepRef.current === 1 && Array.isArray(controller.review.form?.answers.audience)) {
      stepRef.current = 2;
      controller.insertReviewText('5');
      return;
    }
    if (stepRef.current === 2 && controller.review.customInputActive) {
      stepRef.current = 3;
      controller.insertReviewText('2');
    }
  }, [controller]);

  return (
    <Text>
      {`selectedIndex:${controller.review?.selectedActionIndex ?? -1}`}
      {` customInputActive:${controller.review?.customInputActive ? 'true' : 'false'}`}
      {` draft:${controller.review?.draft ?? ''}`}
      {` answer:${JSON.stringify(controller.review?.form?.answers.audience ?? null)}`}
    </Text>
  );
}

function ReviewQueueProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({codara});
  const firedRef = React.useRef(false);

  useEffect(() => {
    if (!controller.review || firedRef.current || controller.review.request.id !== 'approval-1') {
      return;
    }
    firedRef.current = true;
    controller.submitReviewAction();
  }, [controller]);

  return (
    <Text>
      {`reviewCount:${controller.review?.reviewCount ?? 0}`}
      {` reviewId:${controller.review?.request.id ?? 'none'}`}
      {` busy:${controller.review?.busy ? 'true' : 'false'}`}
      {` resumeCount:${(codara as unknown as FakeCodara).resumeCount}`}
    </Text>
  );
}

function SingleReviewProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({codara});
  const firedRef = React.useRef(false);

  useEffect(() => {
    if (!controller.review || firedRef.current) {
      return;
    }
    firedRef.current = true;
    controller.submitReviewAction();
  }, [controller]);

  return (
    <Text>
      {`reviewId:${controller.review?.request.id ?? 'none'}`}
      {` runState:${controller.runState.status}`}
      {` resumeCount:${(codara as unknown as FakeCodara).resumeCount}`}
    </Text>
  );
}

function BackgroundFollowupProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({codara});
  const firedRef = React.useRef(false);

  useEffect(() => {
    if (firedRef.current) {
      return;
    }
    firedRef.current = true;
    controller.submitText('delegate a task and wait');
  }, [controller]);

  return (
    <Text>
      {`runState:${controller.runState.status}`}
      {` latestAssistantNotice:${[...controller.notices].reverse().find((notice) => notice.level === 'assistant')?.content ?? 'none'}`}
      {` streamCalls:${(codara as unknown as FakeCodara).getStreamCallCount()}`}
    </Text>
  );
}

function QueuedPromptProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({codara});
  const stepRef = React.useRef(0);

  useEffect(() => {
    if (stepRef.current === 0) {
      stepRef.current = 1;
      controller.submitText('first prompt');
      return;
    }

    if (stepRef.current === 1 && controller.runState.status === 'running') {
      stepRef.current = 2;
      controller.submitText('second prompt');
    }
  }, [controller]);

  return (
    <Text>
      {`runState:${controller.runState.status}`}
      {` streamCalls:${(codara as unknown as FakeCodara).getStreamCallCount()}`}
    </Text>
  );
}

function QueuedReviewResponseProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({codara});
  const stepRef = React.useRef(0);

  useEffect(() => {
    if (stepRef.current === 0) {
      stepRef.current = 1;
      controller.submitText('foreground prompt');
      return;
    }

    if (stepRef.current === 1 && controller.runState.status === 'running' && controller.review) {
      stepRef.current = 2;
      controller.submitReviewAction();
    }
  }, [controller]);

  return (
    <Text>
      {`runState:${controller.runState.status}`}
      {` review:${controller.review?.request.id ?? 'none'}`}
      {` resumeCount:${(codara as unknown as FakeCodara).resumeCount}`}
    </Text>
  );
}

function ReviewAutoActionProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({
    codara,
    reviewAutoActions: [{action: 'dont_ask_again'}],
  });
  const firedRef = React.useRef(false);

  useEffect(() => {
    if (firedRef.current) {
      return;
    }
    firedRef.current = true;
    controller.submitText('foreground prompt');
  }, [controller]);

  return (
    <Text>
      {`runState:${controller.runState.status}`}
      {` review:${controller.review?.request.id ?? 'none'}`}
      {` resumeCount:${(codara as unknown as FakeCodara).resumeCount}`}
      {` streamCalls:${(codara as unknown as FakeCodara).getStreamCallCount()}`}
    </Text>
  );
}

class FakeCodara {
  private listeners = new Set<(event: CodaraRuntimeEvent) => void>();
  private reviews: ReviewQueryItem[] = [];
  private approvalRequests = new Map<string, ReviewRequest>();
  private agentContext: Record<string, unknown> = {};
  private pendingReview: ReviewRequest | undefined;
  private focusedReviewId: string | undefined;
  private agentRunSummaries: Array<{
    runId: string;
    sessionId: string;
    label: string;
    agentName: string;
    status: string;
    startedAt: string;
    updatedAt: string;
    endedAt?: string;
    summary?: string;
    toolUseCount?: number;
    totalTokens?: number;
  }> = [];
  private blockStream = false;
  private releaseBlockedStreamResolver: (() => void) | undefined;
  private blockApprovalResume = false;
  private releaseBlockedApprovalResumeResolver: (() => void) | undefined;
  private failPauseResumeWhileRunning = false;
  private hydrateSequence: Array<{status: string; pendingReview?: ReviewRequest}> = [];
  private deferredResumeReviewId: string | undefined;
  private deferredResumeRemovalHydratesRemaining = -1;
  private deferredPauseClearHydratesRemaining = -1;
  private readonly streamCalls: CodaraStreamRequest[] = [];
  private readonly queuedStreamChunks: AIMessageChunk[][] = [];
  public resumeCount = 0;
  private readonly sessionState: SessionState = {
    sessionId: 'session-1',
    sessionStatus: 'ready',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  subscribeRuntimeEvents(listener: (event: CodaraRuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: CodaraRuntimeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  setReviews(reviews: ReviewQueryItem[]): void {
    this.reviews = reviews;
    this.approvalRequests = new Map(reviews.map((review) => [
      review.reviewId,
      createReviewRequest(review.reviewId, review.description),
    ]));
    this.focusedReviewId = reviews[0]?.reviewId;
  }

  setReviewRequest(request: ReviewRequest | undefined): void {
    this.pendingReview = request;
  }

  setFocusedReviewRequest(review: ReviewQueryItem, request: ReviewRequest): void {
    this.reviews = [review];
    this.approvalRequests.set(review.reviewId, request);
    this.focusedReviewId = review.reviewId;
  }

  setHydrateSequence(states: Array<{status: string; pendingReview?: ReviewRequest}>): void {
    this.hydrateSequence = [...states];
  }

  failResumePauseWhileRunning(): void {
    this.failPauseResumeWhileRunning = true;
  }

  deferPendingReviewClearOnResume(hydratesBeforeClear = 1): void {
    this.deferredPauseClearHydratesRemaining = Math.max(0, hydratesBeforeClear);
  }

  deferCurrentReviewRemovalOnResume(hydratesBeforeRemoval = 1): void {
    this.deferredResumeRemovalHydratesRemaining = Math.max(0, hydratesBeforeRemoval);
  }

  setAgentRunSummaries(
    agentRunSummaries: Array<{
      runId: string;
      parentSessionId: string;
      label: string;
      agentName: string;
      status: string;
      startedAt: string;
      updatedAt: string;
      endedAt?: string;
      summary?: string;
      toolUseCount?: number;
      totalTokens?: number;
    }>,
  ): void {
    this.agentRunSummaries = agentRunSummaries;
  }

  queueStreamText(text: string): void {
    this.queuedStreamChunks.push([new AIMessageChunk({content: text})]);
  }

  getStreamCalls(): CodaraStreamRequest[] {
    return [...this.streamCalls];
  }

  getStreamCallCount(): number {
    return this.streamCalls.length;
  }

  blockNextStream(): void {
    this.blockStream = true;
  }

  releaseBlockedStream(): void {
    this.blockStream = false;
    this.releaseBlockedStreamResolver?.();
    this.releaseBlockedStreamResolver = undefined;
  }

  blockNextResumeApproval(): void {
    this.blockApprovalResume = true;
  }

  releaseBlockedResumeApproval(): void {
    this.blockApprovalResume = false;
    this.releaseBlockedApprovalResumeResolver?.();
    this.releaseBlockedApprovalResumeResolver = undefined;
  }

  async hydrate() {
    if (this.deferredResumeReviewId && this.deferredResumeRemovalHydratesRemaining === 0) {
      this.reviews = this.reviews.filter((review) => review.reviewId !== this.deferredResumeReviewId);
      this.approvalRequests.delete(this.deferredResumeReviewId);
      this.focusedReviewId = this.reviews[0]?.reviewId;
      this.deferredResumeReviewId = undefined;
      this.deferredResumeRemovalHydratesRemaining = -1;
    } else if (this.deferredResumeReviewId) {
      this.deferredResumeRemovalHydratesRemaining -= 1;
    }

    if (this.deferredPauseClearHydratesRemaining > 0) {
      this.deferredPauseClearHydratesRemaining -= 1;
    } else if (this.deferredPauseClearHydratesRemaining === 0 && this.pendingReview) {
      this.pendingReview = undefined;
      this.deferredPauseClearHydratesRemaining = -1;
    }

    if (this.hydrateSequence.length > 0) {
      const next = this.hydrateSequence.shift()!;
      this.pendingReview = next.pendingReview;
      return {
        status: next.status,
        pendingReview: next.pendingReview,
        messages: [],
      };
    }
    return {
      status: 'idle',
      pendingReview: this.pendingReview,
      messages: [],
    };
  }

  async updateContext(context: Record<string, unknown>) {
    for (const [key, value] of Object.entries(context)) {
      if (value === undefined) {
        delete this.agentContext[key];
      } else {
        this.agentContext[key] = value;
      }
    }
    return this.getAgentState();
  }

  getState(): SessionState {
    return this.sessionState;
  }

  getAgentState() {
    return {
      pendingReview: this.pendingReview,
      messages: [],
      status: 'idle',
      context: this.agentContext,
    };
  }

  listReviewItems(): ReviewQueryItem[] {
    const focused = this.getFocusedReview()?.item.reviewId;
    return this.reviews.map((review) => ({
      ...review,
      isFocused: review.reviewId === focused,
    }));
  }

  getFocusedReview(): FocusedReviewQuery | undefined {
    const focused = this.focusedReviewId
      ? this.reviews.find((review) => review.reviewId === this.focusedReviewId)
      : this.reviews[0];
    if (!focused) {
      return undefined;
    }

    return {
      item: {
        ...focused,
        isFocused: true,
      },
      request: this.approvalRequests.get(focused.reviewId)!,
    };
  }

  async focusReview(reviewId: string): Promise<void> {
    this.focusedReviewId = reviewId;
  }

  getAgentRunSummaries() {
    return this.agentRunSummaries;
  }

  getMcpStatus() {
    return [];
  }

  async listCommands() {
    return [];
  }

  async executeCommand() {
    return {ok: true, output: '', command: ''};
  }

  async *stream(_input?: unknown, _config?: unknown) {
    if (this.blockStream) {
      await new Promise<void>((resolve) => {
        this.releaseBlockedStreamResolver = resolve;
      });
    }
    const chunks = this.queuedStreamChunks.shift() ?? [];
    for (const chunk of chunks) {
      yield chunk;
    }
  }

  async *streamInteraction(request: CodaraStreamRequest) {
    this.streamCalls.push(request);
    switch (request.kind) {
      case 'prompt':
        yield* this.stream(request.input, request.config);
        return;
      case 'continuation':
        yield* this.stream(undefined, {
          ...request.config,
          context: request.context,
        });
        return;
      case 'review':
        if (this.pendingReview) {
          yield* this.resumeReviewStream(request.payload, request.config);
          return;
        }
        yield* this.resumeApprovalStream(request.payload, request.config);
        return;
    }
  }

  async *resumeReviewStream() {
    if (this.failPauseResumeWhileRunning && this.hydrateSequence.length > 0 && this.hydrateSequence[0]?.status === 'running') {
      throw new Error('Agent is currently running.');
    }
    this.resumeCount += 1;
    if (this.deferredPauseClearHydratesRemaining < 0) {
      this.pendingReview = undefined;
    }
    yield* [];
  }

  async *resumeApprovalStream() {
    this.resumeCount += 1;
    if (this.blockApprovalResume) {
      await new Promise<void>((resolve) => {
        this.releaseBlockedApprovalResumeResolver = resolve;
      });
    }
    const currentApprovalId = this.focusedReviewId ?? this.reviews[0]?.reviewId;
    if (currentApprovalId) {
      this.reviews = this.reviews.filter((review) => review.reviewId !== currentApprovalId);
      this.approvalRequests.delete(currentApprovalId);
    }
    this.focusedReviewId = this.reviews[0]?.reviewId;
    yield* [];
  }

  async resumeReview() {
    this.resumeCount += 1;
    if (this.blockApprovalResume) {
      await new Promise<void>((resolve) => {
        this.releaseBlockedApprovalResumeResolver = resolve;
      });
    }
    const currentApprovalId = this.focusedReviewId ?? this.reviews[0]?.reviewId;
    if (currentApprovalId) {
      if (this.deferredResumeRemovalHydratesRemaining >= 0) {
        this.deferredResumeReviewId = currentApprovalId;
      } else {
        this.reviews = this.reviews.filter((review) => review.reviewId !== currentApprovalId);
        this.approvalRequests.delete(currentApprovalId);
      }
    }
    if (!this.deferredResumeReviewId) {
      this.focusedReviewId = this.reviews[0]?.reviewId;
    }
  }

  async dispose() {}

  async listSessions() {
    return [];
  }
}

function createReviewItem(
  reviewId: string,
  agentRunId: string,
  description: string,
): ReviewQueryItem {
  const now = new Date().toISOString();
  return {
    reviewId,
    source: 'agent_run',
    kind: 'approval',
    interactionMode: 'approval',
    blockingScope: 'task',
    description,
    toolName: 'bash',
    createdAt: now,
    updatedAt: now,
    anchor: {
      origin: 'delegated',
      agentRunId,
      childSessionId: `${agentRunId}:child`,
    },
    isFocused: false,
  };
}

function createReviewRequest(id: string, description: string): ReviewRequest {
  return {
    id,
    description,
    action: {
      toolCallId: `${id}:tool`,
      toolName: 'bash',
      toolArgs: {command: 'echo test'},
    },
    review: {
      actionName: 'bash',
      allowedDecisions: ['approve', 'reject'],
    },
    runtime: {
      runId: `${id}:run`,
      turn: 1,
      requestId: `${id}:request`,
      toolIndex: 0,
    },
  };
}

function createAskUserReviewRequest(): ReviewRequest {
  return {
    id: 'ask-user-pause',
    description: 'Collect missing requirements.',
    action: {
      toolCallId: 'ask-user-tool',
      toolName: 'AskUserQuestion',
      toolArgs: {},
    },
    review: {
      actionName: 'AskUserQuestion',
      allowedDecisions: ['approve'],
    },
    runtime: {
      runId: 'ask-user-run',
      turn: 1,
      requestId: 'ask-user-request',
      toolIndex: 0,
    },
    channel: 'interaction-center',
    ui: {
      actions: [
        {id: 'submit', label: 'Submit', kind: 'primary'},
        {id: 'cancel', label: 'Cancel', kind: 'secondary'},
      ],
      form: {
        tabs: [
          {
            id: 'language',
            label: 'Language',
            question: 'Which language?',
            input: 'select',
            options: [
              {id: 'python', label: 'Python'},
              {id: 'node', label: 'Node.js'},
            ],
          },
          {
            id: 'complexity',
            label: 'Complexity',
            question: 'How complex?',
            input: 'select',
            options: [
              {id: 'simple', label: 'Simple'},
              {id: 'standard', label: 'Standard'},
            ],
          },
        ],
      },
    },
  };
}

function createMultiselectAskUserReviewRequest(): ReviewRequest {
  return {
    id: 'ask-user-multiselect-pause',
    description: 'Collect target users.',
    action: {
      toolCallId: 'ask-user-multiselect-tool',
      toolName: 'AskUserQuestion',
      toolArgs: {},
    },
    review: {
      actionName: 'AskUserQuestion',
      allowedDecisions: ['approve'],
    },
    runtime: {
      runId: 'ask-user-multiselect-run',
      turn: 1,
      requestId: 'ask-user-multiselect-request',
      toolIndex: 0,
    },
    channel: 'interaction-center',
    ui: {
      actions: [
        {id: 'submit', label: 'Submit', kind: 'primary'},
        {id: 'cancel', label: 'Cancel', kind: 'secondary'},
      ],
      form: {
        tabs: [
          {
            id: 'audience',
            label: 'Audience',
            question: 'Who is this for?',
            input: 'multiselect',
            options: [
              {id: 'solo', label: '独立开发者'},
              {id: 'team', label: '开发团队'},
              {id: 'enterprise', label: '企业客户'},
              {id: 'non-tech', label: '非技术用户'},
            ],
          },
        ],
      },
    },
  };
}

async function waitFor(
  predicate: () => boolean,
  options: {timeoutMs?: number; intervalMs?: number} = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 500;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Condition was not satisfied before timeout');
}
