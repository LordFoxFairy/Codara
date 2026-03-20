import {describe, expect, it} from 'bun:test';
import React, {useEffect} from 'react';
import {Text} from 'ink';
import {render} from 'ink-testing-library';
import {AIMessageChunk} from '@langchain/core/messages';
import type {
  ApprovalQueryReview,
  ApprovalQuerySummary,
  Codara,
  CodaraRuntimeEvent,
  SessionState,
  TeamQueryDetail,
} from '@/index';
import type {PauseRequest} from '@shared/contracts/agent-types';
import {useCliController} from '../../../src/cli/app/use-cli-controller';

describe('useCliController background refresh', () => {
  it('refreshes queued approvals and active team detail when background events arrive', async () => {
    const codara = new FakeCodara();
    codara.setFocusedTeam('team-1');
    const rendered = render(<ControllerProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('teamStatus:running'));
      expect(rendered.lastFrame() ?? '').toContain('approvalCount:0');
      expect(rendered.lastFrame() ?? '').toContain('teamStatus:running');

      codara.setApprovals([
        createApprovalSummary('approval-1', 'run-1', 'Approve alpha'),
        createApprovalSummary('approval-2', 'run-2', 'Approve beta'),
      ]);
      codara.setTeamDetail({
        ...codara.getTeamDetail('team-1')!,
        status: 'paused',
      });
      codara.emit({
        id: 'task-event-1',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'task',
        phase: 'update',
        status: 'paused',
        label: 'Delegated task waiting for review',
      });

      await waitFor(() => (rendered.lastFrame() ?? '').includes('approvalCount:2'));
      expect(rendered.lastFrame() ?? '').toContain('approvalId:approval-1');
      expect(rendered.lastFrame() ?? '').toContain('teamStatus:paused');
    } finally {
      rendered.unmount();
    }
  });

  it('derives the focused team detail from runtime teamSurface instead of local dashboard focus', async () => {
    const codara = new FakeCodara();
    codara.setTeamDetails([
      {
        teamId: 'team-1',
        name: 'Team One',
        status: 'running',
        goal: 'Ship it',
        members: [],
        jobs: [],
      },
      {
        teamId: 'team-2',
        name: 'Team Two',
        status: 'paused',
        goal: 'Review it',
        members: [],
        jobs: [],
      },
    ]);
    codara.setFocusedTeam('team-2');
    const rendered = render(<ControllerProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('teamId:team-2'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('teamId:team-2');
      expect(frame).toContain('teamName:Team Two');
      expect(frame).toContain('teamStatus:paused');
      expect(frame).not.toContain('teamId:team-1');
    } finally {
      rendered.unmount();
    }
  });

  it('treats the only visible team as the default current team detail even without explicit focus', async () => {
    const codara = new FakeCodara();
    codara.setTeamDetails([
      {
        teamId: 'team-1',
        name: 'Solo Team',
        status: 'running',
        goal: 'Ship it',
        members: [],
        jobs: [],
      },
    ]);
    const rendered = render(<ControllerProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('teamId:team-1'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('teamId:team-1');
      expect(frame).toContain('teamName:Solo Team');
      expect(frame).toContain('teamStatus:running');
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
        kind: 'task',
        phase: 'end',
        status: 'done',
        label: 'Delegated task completed',
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
        kind: 'task',
        phase: 'end',
        status: 'done',
        label: 'Delegated task completed',
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
    codara.setTaskRunSummaries([
      {
        runId: 'run-done',
        sessionId: 'session-1',
        label: 'Delegating Explore: Analyze the tech stack',
        agentName: 'Explore',
        status: 'completed',
        startedAt: new Date(Date.now() - 10_000).toISOString(),
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      },
      {
        runId: 'run-still-running',
        sessionId: 'session-1',
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
        kind: 'task',
        phase: 'end',
        status: 'done',
        label: 'Delegated task completed',
        detail: 'Tech stack child summary',
        parentId: 'task-run:run-done',
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

      codara.setTaskRunSummaries([
        {
          runId: 'run-done',
          sessionId: 'session-1',
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
          sessionId: 'session-1',
          label: 'Delegating Explore: Analyze the architecture',
          agentName: 'Explore',
          status: 'paused',
          startedAt: new Date(Date.now() - 8_000).toISOString(),
          updatedAt: new Date().toISOString(),
          summary: 'Architecture child summary',
        },
      ]);
      codara.emit({
        id: 'task-run:run-done',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'task',
        phase: 'start',
        status: 'running',
        label: 'Delegating Explore: Analyze the tech stack',
      });
      codara.emit({
        id: 'task-run:run-paused',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'task',
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
        kind: 'task',
        phase: 'end',
        status: 'done',
        label: 'Delegated task completed',
        detail: 'Tech stack child summary',
        parentId: 'task-run:run-done',
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

      codara.setTaskRunSummaries([
        {
          runId: 'run-tech',
          sessionId: 'session-1',
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
          sessionId: 'session-1',
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
        id: 'task-run:run-tech',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'task',
        phase: 'start',
        status: 'running',
        label: 'Delegating Explore: Analyze the tech stack',
      });
      codara.emit({
        id: 'task-run:run-structure',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'task',
        phase: 'start',
        status: 'running',
        label: 'Delegating Explore: Analyze the project structure',
      });

      codara.releaseBlockedStream();
      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:done'));

      codara.setTaskRunSummaries([
        {
          runId: 'run-tech',
          sessionId: 'session-1',
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
          sessionId: 'session-1',
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
        kind: 'task',
        phase: 'end',
        status: 'done',
        label: 'Delegated task completed',
        detail: 'Structure child summary',
        parentId: 'task-run:run-structure',
      });

      await waitFor(() => codara.getStreamCallCount() === 2);
      await waitFor(() => (rendered.lastFrame() ?? '').includes('streamCalls:2'));
      const continuationCall = codara.getStreamCalls()[1];
      expect(continuationCall?.input).toBeUndefined();
      expect(continuationCall?.config).toEqual(expect.objectContaining({
        streamMode: 'messages',
        context: {
          codaraTaskCompletion: {
            tasks: [
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
        kind: 'task',
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
        kind: 'task',
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
        kind: 'task',
        phase: 'start',
        status: 'running',
        label: 'Delegating Explore: Analyze architecture',
        detail: 'pending',
        parentId: 'turn-root-1',
      });

      codara.setTaskRunSummaries([
        {
          runId: 'run-tech',
          sessionId: 'session-1',
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
        id: 'task-run:run-tech',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'task',
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
        kind: 'task',
        phase: 'end',
        status: 'done',
        label: 'Delegated task completed',
        detail: 'Tech stack summary',
        parentId: 'task-run:run-tech',
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
        kind: 'task',
        phase: 'end',
        status: 'done',
        label: 'Delegated task completed',
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
        kind: 'task',
        phase: 'end',
        status: 'done',
        label: 'Delegated task completed',
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
      codara.setApprovals([
        createApprovalSummary('approval-review', 'run-review', 'Waiting for approval on glob'),
      ]);
      codara.emit({
        id: 'task-event-review',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'task',
        phase: 'update',
        status: 'paused',
        label: 'Delegated task waiting for review',
        detail: 'Waiting for approval on glob',
        parentId: 'task-run:run-review',
      });

      await waitFor(() => (rendered.lastFrame() ?? '').includes('hil:approval-review'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('runState:paused');
      expect(frame).toContain('desc:Waiting for approval on glob');
    } finally {
      codara.releaseBlockedStream();
      rendered.unmount();
    }
  });

  it('surfaces team-member review immediately even while the parent turn is still marked running', async () => {
    const codara = new FakeCodara();
    codara.blockNextStream();
    const rendered = render(<BackgroundReviewProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('runState:running'));
      codara.setApprovals([
        createTeamApprovalSummary('approval-team-review', 'team-1', 'member-1', 'Waiting for approval on read_file'),
      ]);
      codara.emit({
        id: 'team-event-review',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'team',
        phase: 'update',
        status: 'paused',
        label: 'Worker member-1 paused: Waiting for approval on read_file',
        detail: JSON.stringify(createPauseRequest('approval-team-review', 'Waiting for approval on read_file')),
        parentId: 'team-root:team-1',
      });

      await waitFor(() => (rendered.lastFrame() ?? '').includes('hil:approval-team-review'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('runState:paused');
      expect(frame).toContain('desc:Waiting for approval on read_file');
    } finally {
      codara.releaseBlockedStream();
      rendered.unmount();
    }
  });

  it('advances to the next queued approval after the current approval is submitted', async () => {
    const codara = new FakeCodara();
    codara.blockNextResumeApproval();
    codara.setApprovals([
      createApprovalSummary('approval-1', 'run-1', 'Waiting for approval on glob'),
      createApprovalSummary('approval-2', 'run-2', 'Waiting for approval on read_file'),
    ]);
    const rendered = render(<ApprovalQueueProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('busy:true'));
      const busyFrame = rendered.lastFrame() ?? '';
      expect(busyFrame).toContain('approvalCount:2');
      expect(busyFrame).toContain('approvalId:approval-1');
      expect(busyFrame).toContain('busy:true');
      expect(busyFrame).toContain('resumeCount:1');

      codara.releaseBlockedResumeApproval();
      await waitFor(() => (rendered.lastFrame() ?? '').includes('approvalId:approval-2'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('approvalCount:1');
      expect(frame).toContain('approvalId:approval-2');
      expect(frame).toContain('resumeCount:1');
    } finally {
      rendered.unmount();
    }
  });

  it('advances to the next queued team-member approval while only the approved member resumes', async () => {
    const codara = new FakeCodara();
    codara.blockNextResumeApproval();
    codara.setApprovals([
      createTeamApprovalSummary('approval-team-1', 'team-1', 'member-1', 'Waiting for approval on read_file'),
      createTeamApprovalSummary('approval-team-2', 'team-1', 'member-2', 'Waiting for approval on glob'),
    ]);
    const rendered = render(<SingleApprovalProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('approvalId:approval-team-1'));
      expect(rendered.lastFrame() ?? '').toContain('resumeCount:1');
      codara.releaseBlockedResumeApproval();
      await waitFor(() => (rendered.lastFrame() ?? '').includes('approvalId:approval-team-2'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('resumeCount:1');
      expect(frame).toContain('approvalId:approval-team-2');
    } finally {
      rendered.unmount();
    }
  });

  it('dismisses a single permission approval immediately after submit while the delegated task resumes in the background', async () => {
    const codara = new FakeCodara();
    codara.blockNextResumeApproval();
    codara.setApprovals([
      createApprovalSummary('approval-1', 'run-1', 'Waiting for approval on read_file'),
    ]);
    const rendered = render(<SingleApprovalProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('resumeCount:1'));
      await waitFor(() => (rendered.lastFrame() ?? '').includes('approvalId:none'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('approvalId:none');
      expect(frame).toContain('runState:done');
      expect(frame).toContain('resumeCount:1');
    } finally {
      codara.releaseBlockedResumeApproval();
      rendered.unmount();
    }
  });

  it('activates the highlighted AskUser option before attempting a final submit', async () => {
    const codara = new FakeCodara();
    codara.setPauseRequest(createAskUserPauseRequest());
    const rendered = render(<HilSubmitProbe codara={codara as unknown as Codara} />);

    try {
      await waitFor(() => (rendered.lastFrame() ?? '').includes('focus:input'));
      await waitFor(() => (rendered.lastFrame() ?? '').includes('activeTab:1'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('answer:Python');
      expect(frame).toContain('resumeCount:0');
    } finally {
      rendered.unmount();
    }
  });
});

function ControllerProbe(
  {codara, teamId}: {codara: Codara; teamId?: string},
): React.JSX.Element {
  const controller = useCliController({codara});
  const {enterTeam} = controller;

  useEffect(() => {
    if (teamId) {
      enterTeam(teamId);
    }
  }, [enterTeam, teamId]);

  return (
    <Text>
      {`approvalCount:${controller.hilReview?.approvalCount ?? 0}`}
      {` approvalId:${controller.hilReview?.request.id ?? 'none'}`}
      {` teamId:${controller.teamDetailState?.teamId ?? 'none'}`}
      {` teamName:${controller.teamDetailState?.teamName ?? 'none'}`}
      {` teamStatus:${controller.teamDetailState?.status ?? 'none'}`}
      {` latestNotice:${controller.notices[controller.notices.length - 1]?.content ?? 'none'}`}
      {` latestAssistantNotice:${[...controller.notices].reverse().find((notice) => notice.level === 'assistant')?.content ?? 'none'}`}
    </Text>
  );
}

function HilSubmitProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({codara});
  const firedRef = React.useRef(false);

  useEffect(() => {
    if (!controller.hilReview || firedRef.current) {
      return;
    }
    firedRef.current = true;
    controller.submitHilAction();
  }, [controller]);

  return (
    <Text>
      {`focus:${controller.hilReview?.focus ?? 'none'}`}
      {` activeTab:${controller.hilReview?.form?.activeTabIndex ?? -1}`}
      {` answer:${String(controller.hilReview?.form?.answers.language ?? '')}`}
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
      {` hil:${controller.hilReview?.request.id ?? 'none'}`}
      {` desc:${controller.hilReview?.request.description ?? 'none'}`}
    </Text>
  );
}

function ApprovalQueueProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({codara});
  const firedRef = React.useRef(false);

  useEffect(() => {
    if (!controller.hilReview || firedRef.current || controller.hilReview.request.id !== 'approval-1') {
      return;
    }
    firedRef.current = true;
    controller.submitHilAction();
  }, [controller]);

  return (
    <Text>
      {`approvalCount:${controller.hilReview?.approvalCount ?? 0}`}
      {` approvalId:${controller.hilReview?.request.id ?? 'none'}`}
      {` busy:${controller.hilReview?.busy ? 'true' : 'false'}`}
      {` resumeCount:${(codara as unknown as FakeCodara).resumeCount}`}
    </Text>
  );
}

function SingleApprovalProbe({codara}: {codara: Codara}): React.JSX.Element {
  const controller = useCliController({codara});
  const firedRef = React.useRef(false);

  useEffect(() => {
    if (!controller.hilReview || firedRef.current) {
      return;
    }
    firedRef.current = true;
    controller.submitHilAction();
  }, [controller]);

  return (
    <Text>
      {`approvalId:${controller.hilReview?.request.id ?? 'none'}`}
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

class FakeCodara {
  private listeners = new Set<(event: CodaraRuntimeEvent) => void>();
  private approvals: ApprovalQuerySummary[] = [];
  private approvalRequests = new Map<string, PauseRequest>();
  private teamDetails = new Map<string, TeamQueryDetail>([
    ['team-1', {
      teamId: 'team-1',
      name: 'Team One',
      status: 'running',
      goal: 'Ship it',
      members: [],
      jobs: [],
    }],
  ]);
  private agentContext: Record<string, unknown> = {};
  private pendingPause: PauseRequest | undefined;
  private focusedApprovalId: string | undefined;
  private taskRunSummaries: Array<{
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
  private readonly streamCalls: Array<{input: unknown; config: unknown}> = [];
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

  setApprovals(approvals: ApprovalQuerySummary[]): void {
    this.approvals = approvals;
    this.approvalRequests = new Map(approvals.map((approval) => [
      approval.approvalId,
      createPauseRequest(approval.approvalId, approval.description),
    ]));
    this.focusedApprovalId = approvals[0]?.approvalId;
  }

  setTeamDetail(detail: TeamQueryDetail | undefined): void {
    this.teamDetails = new Map(detail ? [[detail.teamId, detail]] : []);
  }

  setTeamDetails(details: TeamQueryDetail[]): void {
    this.teamDetails = new Map(details.map((detail) => [detail.teamId, detail]));
  }

  setFocusedTeam(teamId: string | undefined): void {
    this.agentContext = {
      ...(teamId ? {
        teamSurface: {
          activeTeamId: teamId,
          teamRole: 'leader',
          teamMode: 'leader',
        },
      } : {}),
    };
  }

  setPauseRequest(request: PauseRequest | undefined): void {
    this.pendingPause = request;
  }

  setTaskRunSummaries(
    taskRunSummaries: Array<{
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
    }>,
  ): void {
    this.taskRunSummaries = taskRunSummaries;
  }

  queueStreamText(text: string): void {
    this.queuedStreamChunks.push([new AIMessageChunk({content: text})]);
  }

  getStreamCalls(): Array<{input: unknown; config: unknown}> {
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
    return {
      status: 'idle',
      pendingPause: this.pendingPause,
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
      pendingPause: this.pendingPause,
      messages: [],
      status: 'idle',
      context: this.agentContext,
    };
  }

  getApprovalSummaries(): ApprovalQuerySummary[] {
    const focused = this.getFocusedApprovalReview()?.summary.approvalId;
    return this.approvals.map((approval) => ({
      ...approval,
      isForeground: approval.approvalId === focused,
    }));
  }

  getFocusedApprovalReview(): ApprovalQueryReview | undefined {
    const focused = this.focusedApprovalId
      ? this.approvals.find((approval) => approval.approvalId === this.focusedApprovalId)
      : this.approvals[0];
    if (!focused) {
      return undefined;
    }

    return {
      summary: {
        ...focused,
        isForeground: true,
      },
      request: this.approvalRequests.get(focused.approvalId)!,
    };
  }

  async focusApproval(approvalId: string): Promise<void> {
    this.focusedApprovalId = approvalId;
  }

  getTeamSummaries() {
    return [...this.teamDetails.values()].map((detail) => ({
      teamId: detail.teamId,
      name: detail.name,
      status: detail.status,
      goal: detail.goal,
      memberCount: detail.members.length,
      jobProgress: {done: 0, total: detail.jobs.length},
      startedAt: new Date().toISOString(),
    }));
  }

  getTeamDetail(teamId: string): TeamQueryDetail | undefined {
    return this.teamDetails.get(teamId);
  }

  getTaskRunSummaries() {
    return this.taskRunSummaries;
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

  async *stream(input?: unknown, config?: unknown) {
    this.streamCalls.push({input, config});
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

  async *resumePauseStream() {
    this.resumeCount += 1;
    yield* [];
  }

  async *resumeApprovalStream() {
    this.resumeCount += 1;
    if (this.blockApprovalResume) {
      await new Promise<void>((resolve) => {
        this.releaseBlockedApprovalResumeResolver = resolve;
      });
    }
    const currentApprovalId = this.focusedApprovalId ?? this.approvals[0]?.approvalId;
    if (currentApprovalId) {
      this.approvals = this.approvals.filter((approval) => approval.approvalId !== currentApprovalId);
      this.approvalRequests.delete(currentApprovalId);
    }
    this.focusedApprovalId = this.approvals[0]?.approvalId;
    yield* [];
  }

  async resumeApproval() {
    this.resumeCount += 1;
    if (this.blockApprovalResume) {
      await new Promise<void>((resolve) => {
        this.releaseBlockedApprovalResumeResolver = resolve;
      });
    }
    const currentApprovalId = this.focusedApprovalId ?? this.approvals[0]?.approvalId;
    if (currentApprovalId) {
      this.approvals = this.approvals.filter((approval) => approval.approvalId !== currentApprovalId);
      this.approvalRequests.delete(currentApprovalId);
    }
    this.focusedApprovalId = this.approvals[0]?.approvalId;
  }

  async dispose() {}

  async listSessions() {
    return [];
  }
}

function createApprovalSummary(
  approvalId: string,
  taskRunId: string,
  description: string,
): ApprovalQuerySummary {
  const now = new Date().toISOString();
  return {
    approvalId,
    source: 'task_run',
    description,
    toolName: 'bash',
    createdAt: now,
    updatedAt: now,
    taskRunId,
    childSessionId: `${taskRunId}:child`,
    isForeground: false,
  };
}

function createTeamApprovalSummary(
  approvalId: string,
  teamId: string,
  memberId: string,
  description: string,
): ApprovalQuerySummary {
  const now = new Date().toISOString();
  return {
    approvalId,
    source: 'team_member',
    description,
    toolName: 'read_file',
    createdAt: now,
    updatedAt: now,
    teamId,
    memberId,
    memberName: memberId,
    isForeground: false,
  };
}

function createPauseRequest(id: string, description: string): PauseRequest {
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

function createAskUserPauseRequest(): PauseRequest {
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
        {id: 'chat', label: 'Chat about this', kind: 'secondary'},
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
