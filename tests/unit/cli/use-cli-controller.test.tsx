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
});

function ControllerProbe(
  {codara, teamId}: {codara: Codara; teamId?: string},
): React.JSX.Element {
  const controller = useCliController({codara});

  useEffect(() => {
    if (teamId) {
      controller.enterTeam(teamId);
    }
  }, [controller.enterTeam, teamId]);

  return (
    <Text>
      {`approvalCount:${controller.hilReview?.approvalCount ?? 0}`}
      {` approvalId:${controller.hilReview?.request.id ?? 'none'}`}
      {` teamStatus:${controller.teamDetailState?.status ?? 'none'}`}
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

  async hydrate() {
    return {
      status: 'idle',
      pendingPause: undefined,
      messages: [],
    };
  }

  getState(): SessionState {
    return this.sessionState;
  }

  getAgentState() {
    return {
      pendingPause: undefined,
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

  async *stream() {}

  async *resumePauseStream() {}

  async *resumeApprovalStream() {}

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
