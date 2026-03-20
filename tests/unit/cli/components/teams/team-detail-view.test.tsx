import {describe, expect, it} from 'bun:test';
import {render} from 'ink-testing-library';
import {TeamDetailView} from '../../../../../src/cli/components/teams/team-detail-view';
import type {TeamDetailState} from '../../../../../src/cli/hooks/use-team-detail';

function createTeamDetailState(overrides: Partial<TeamDetailState> = {}): TeamDetailState {
  return {
    teamId: 'team-1',
    teamName: 'Codara Analysis Team',
    goal: 'Analyze the runtime',
    status: 'running',
    members: [
      {
        memberId: 'leader',
        name: 'Main agent',
        role: 'leader',
        status: 'running',
        tokens: 0,
      },
    ],
    jobs: [],
    activity: [],
    tokenUsage: 0,
    estimatedCost: 0,
    ...overrides,
  };
}

describe('TeamDetailView', () => {
  it('hides zero-value cost and token usage noise from the header', () => {
    const {lastFrame} = render(<TeamDetailView state={createTeamDetailState()} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Codara Analysis Team');
    expect(frame).toContain('Team');
    expect(frame).toContain('Main agent');
    expect(frame).toContain('receives your messages in this workspace');
    expect(frame).not.toContain('$0.00');
    expect(frame).not.toContain('0 tok');
  });
});
