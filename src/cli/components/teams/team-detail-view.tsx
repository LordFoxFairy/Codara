import React from 'react';
import { Box, Text } from 'ink';
import { MemberPanel } from './member-panel.js';
import { JobBoardPanel } from './job-board-panel.js';
import { TeamActivityLog } from './team-activity-log.js';
import type { TeamDetailState } from '../../hooks/use-team-detail.js';

interface TeamDetailViewProps {
  state: TeamDetailState;
}

export function TeamDetailView({ state }: TeamDetailViewProps) {
  const progress = state.jobs.filter(j => j.status === 'done').length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box gap={2}>
        <Text bold color="cyan">Team: {state.teamName}</Text>
        <Text>{progress}/{state.jobs.length} jobs done</Text>
        <Text dimColor>${state.estimatedCost.toFixed(2)}</Text>
      </Box>
      <Box flexDirection="column" gap={1} marginTop={1}>
        <MemberPanel members={state.members} />
        <JobBoardPanel jobs={state.jobs} />
        <TeamActivityLog activity={state.activity} />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Type a message to send to this team... [leave] [pause] [kill]</Text>
      </Box>
    </Box>
  );
}
