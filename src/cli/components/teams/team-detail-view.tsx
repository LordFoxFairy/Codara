import { Box, Text } from 'ink';
import { MemberPanel } from './member-panel.js';
import { JobBoardPanel } from './job-board-panel.js';
import { TeamActivityLog } from './team-activity-log.js';
import type { TeamDetailState } from '../../hooks/use-team-detail.js';
import { theme } from '../../utils/theme.js';
import { formatTokenCount } from '../../utils/format.js';

const TEAM_STATUS_COLORS: Record<string, string> = {
  created: theme.chrome.dimmed,
  spawning: theme.status.running,
  running: theme.status.responding,
  paused: theme.status.paused,
  completing: theme.role.system,
  completed: theme.status.done,
  failed: theme.role.error,
};

interface TeamDetailViewProps {
  state: TeamDetailState;
  focusedMemberId?: string;
  onFocusNext?: () => void;
}

export function TeamDetailView({ state, focusedMemberId, onFocusNext: _onFocusNext }: TeamDetailViewProps) {
  const doneCount = state.jobs.filter(j => j.status === 'done').length;
  const totalJobs = state.jobs.length;
  const statusColor = TEAM_STATUS_COLORS[state.status] ?? 'white';
  const showCost = state.estimatedCost > 0;
  const showTokens = state.tokenUsage > 0;
  const workerCount = state.members.filter((member) => member.role !== 'leader').length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.interactive.accent} paddingX={1}>
      <Box gap={2} flexWrap="nowrap">
        <Text bold color={theme.interactive.accent}>{state.teamName}</Text>
        <Text color={statusColor}>{state.status}</Text>
        <Text dimColor>{workerCount} {workerCount === 1 ? 'worker' : 'workers'}</Text>
        <Text dimColor>{doneCount}/{totalJobs} jobs done</Text>
        {showCost ? <Text dimColor>${state.estimatedCost.toFixed(2)}</Text> : null}
        {showTokens ? <Text dimColor>{formatTokenCount(state.tokenUsage)} tok</Text> : null}
      </Box>
      {state.goal && (
        <Text dimColor>Goal: {state.goal}</Text>
      )}
      {focusedMemberId ? (
        <Text dimColor>Speaking to: <Text color={theme.interactive.accent}>{
          state.members.find(m => m.memberId === focusedMemberId)?.name ?? focusedMemberId
        }</Text> (Tab to switch, Esc for leader)</Text>
      ) : (
        <Text dimColor>Speaking to: <Text bold>Leader</Text> · Tab to focus a worker · @name to message directly</Text>
      )}

      <Box flexDirection="column" gap={1} marginTop={1}>
        <MemberPanel members={state.members} jobs={state.jobs} focusedMemberId={focusedMemberId} />
        <JobBoardPanel jobs={state.jobs} />
        <TeamActivityLog activity={state.activity} />
      </Box>

      <Box marginTop={1} gap={1}>
        <Text dimColor>Team:</Text>
        <Text color={theme.interactive.secondaryButton}>spawn_teammate</Text>
        <Text dimColor>·</Text>
        <Text color={theme.interactive.secondaryButton}>assign_job</Text>
        <Text dimColor>·</Text>
        <Text color={theme.status.ready}>review_job</Text>
        {state.status === 'running' ? (
          <>
            <Text dimColor>·</Text>
            <Text color={theme.status.paused}>pause</Text>
          </>
        ) : null}
        <Text dimColor>·</Text>
        <Text color={theme.interactive.danger}>shutdown_team</Text>
      </Box>
    </Box>
  );
}
