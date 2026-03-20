import {describe, expect, it} from 'bun:test';
import React, {useEffect} from 'react';
import {Text} from 'ink';
import {render} from 'ink-testing-library';
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
    const rendered = render(<ControllerProbe codara={codara as unknown as Codara} teamId="team-1" />);

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

  it('adds a stable notice when a background task completes after the foreground turn ends', async () => {
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

      await waitFor(() => (rendered.lastFrame() ?? '').includes('Found the project architecture summary'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('Found the');
      expect(frame).toContain('project architecture summary');
      expect(frame).not.toContain('Background task finished:');
      expect(frame).not.toContain('Background task completed');
    } finally {
      rendered.unmount();
    }
  });

  it('adds an assistant-style follow-up after a background task completes', async () => {
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

      await waitFor(() => (rendered.lastFrame() ?? '').includes('latestAssistantNotice:Codara is a terminal-first AI agent runtime.'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('terminal-first AI agent runtime');
    } finally {
      rendered.unmount();
    }
  });

  it('flushes a background task follow-up that arrives before the parent turn fully settles', async () => {
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

      await waitFor(() => (rendered.lastFrame() ?? '').includes('latestAssistantNotice:Queued child summary'));
      const frame = rendered.lastFrame() ?? '';
      expect(frame).toContain('runState:done');
      expect(frame).toContain('Queued child summary');
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
    </Text>
  );
}

class FakeCodara {
  private listeners = new Set<(event: CodaraRuntimeEvent) => void>();
  private approvals: ApprovalQuerySummary[] = [];
  private approvalRequests = new Map<string, PauseRequest>();
  private teamDetail: TeamQueryDetail | undefined = {
    teamId: 'team-1',
    name: 'Team One',
    status: 'running',
    goal: 'Ship it',
    members: [],
    jobs: [],
  };
  private pendingPause: PauseRequest | undefined;
  private blockStream = false;
  private releaseBlockedStreamResolver: (() => void) | undefined;
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
  }

  setTeamDetail(detail: TeamQueryDetail | undefined): void {
    this.teamDetail = detail;
  }

  setPauseRequest(request: PauseRequest | undefined): void {
    this.pendingPause = request;
  }

  blockNextStream(): void {
    this.blockStream = true;
  }

  releaseBlockedStream(): void {
    this.blockStream = false;
    this.releaseBlockedStreamResolver?.();
    this.releaseBlockedStreamResolver = undefined;
  }

  async hydrate() {
    return {
      status: 'idle',
      pendingPause: this.pendingPause,
      messages: [],
    };
  }

  getState(): SessionState {
    return this.sessionState;
  }

  getAgentState() {
    return {
      pendingPause: this.pendingPause,
      messages: [],
      status: 'idle',
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
    const focused = this.approvals[0];
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

  async focusApproval(): Promise<void> {}

  getTeamSummaries() {
    return this.teamDetail ? [{
      teamId: this.teamDetail.teamId,
      name: this.teamDetail.name,
      status: this.teamDetail.status,
      goal: this.teamDetail.goal,
      memberCount: this.teamDetail.members.length,
      jobProgress: {done: 0, total: this.teamDetail.jobs.length},
      startedAt: new Date().toISOString(),
    }] : [];
  }

  getTeamDetail(teamId: string): TeamQueryDetail | undefined {
    return this.teamDetail?.teamId === teamId ? this.teamDetail : undefined;
  }

  getTaskRunSummaries() {
    return [];
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

  async *stream() {
    if (this.blockStream) {
      await new Promise<void>((resolve) => {
        this.releaseBlockedStreamResolver = resolve;
      });
    }
    if (Math.random() < 0) {
      yield new AIMessageChunk({content: ''});
    }
  }

  async *resumePauseStream() {
    this.resumeCount += 1;
    yield* [];
  }

  async *resumeApprovalStream() {
    this.resumeCount += 1;
    yield* [];
  }

  async resumeApproval() {}

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
