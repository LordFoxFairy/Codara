import React from 'react';
import { Box, Text } from 'ink';
import type { TeamJobInfo } from '../../hooks/use-team-detail.js';
import { theme } from '../../utils/theme.js';

const JOB_ICONS: Record<string, string> = {
  planned: '○',
  ready: '◎',
  in_progress: '◉',
  review: '◈',
  done: '✓',
  failed: '✗',
};

const JOB_COLORS: Record<string, string> = {
  planned: theme.chrome.dimmed,
  ready: theme.status.ready,
  in_progress: theme.role.system,
  review: theme.role.warning,
  done: theme.status.done,
  failed: theme.role.error,
};

/** Sort priority: in_progress → ready → review → planned → done → failed */
const STATUS_ORDER: Record<string, number> = {
  in_progress: 0,
  ready: 1,
  review: 2,
  planned: 3,
  done: 4,
  failed: 5,
};

interface JobBoardPanelProps {
  jobs: TeamJobInfo[];
}

export function JobBoardPanel({ jobs }: JobBoardPanelProps) {
  if (jobs.length === 0) return <Text dimColor>No jobs planned yet</Text>;

  const sorted = [...jobs].sort((a, b) => {
    const pa = STATUS_ORDER[a.status] ?? 99;
    const pb = STATUS_ORDER[b.status] ?? 99;
    return pa - pb;
  });

  return (
    <Box flexDirection="column">
      <Text bold>Job Board</Text>
      {sorted.map(job => {
        const color = JOB_COLORS[job.status] ?? 'white';
        const icon = JOB_ICONS[job.status] ?? '?';
        const isBlocked = job.blockedBy.length > 0;

        return (
          <Box key={job.id} gap={1}>
            <Text color={color}>{icon}</Text>
            <Text color={color}>{job.id}:</Text>
            <Text>{job.title}</Text>
            {job.assignee && <Text dimColor>({job.assignee})</Text>}
            {isBlocked && (
              <Text color={theme.role.warning}>⊘ blocked by {job.blockedBy.join(', ')}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
