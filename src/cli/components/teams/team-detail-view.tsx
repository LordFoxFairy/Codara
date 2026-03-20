import React from 'react';
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
}

export function TeamDetailView({ state }: TeamDetailViewProps) {
  const doneCount = state.jobs.filter(j => j.status === 'done').length;
  const totalJobs = state.jobs.length;
  const statusColor = TEAM_STATUS_COLORS[state.status] ?? 'white';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.interactive.accent} paddingX={1}>
      {/* Header row */}
      <Box gap={2}>
        <Text bold color={theme.interactive.accent}>Team: {state.teamName}</Text>
        <Text color={statusColor}>{state.status}</Text>
        <Text dimColor>{doneCount}/{totalJobs} jobs done</Text>
        <Text dimColor>${state.estimatedCost.toFixed(2)}</Text>
        <Text dimColor>{formatTokenCount(state.tokenUsage)} tok</Text>
      </Box>

      {/* Goal */}
      {state.goal && (
        <Text dimColor>Goal: {state.goal}</Text>
      )}

      {/* Panels */}
      <Box flexDirection="column" gap={1} marginTop={1}>
        <MemberPanel members={state.members} jobs={state.jobs} />
        <JobBoardPanel jobs={state.jobs} />
        <TeamActivityLog activity={state.activity} />
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>Use </Text>
        <Text color={theme.interactive.secondaryButton}>/team leave</Text>
        <Text dimColor>, </Text>
        <Text color={theme.status.paused}>/team pause &lt;name&gt;</Text>
        <Text dimColor>, </Text>
        <Text color={theme.status.responding}>/team resume &lt;name&gt;</Text>
        <Text dimColor>, or </Text>
        <Text color={theme.interactive.danger}>/team kill &lt;name&gt;</Text>
      </Box>
    </Box>
  );
}
