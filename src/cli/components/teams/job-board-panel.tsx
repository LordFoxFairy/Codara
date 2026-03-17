import React from 'react';
import { Box, Text } from 'ink';
import type { TeamJobInfo } from '../../hooks/use-team-detail.js';

const JOB_ICONS: Record<string, string> = {
  planned: '○',
  ready: '◎',
  in_progress: '◉',
  review: '◈',
  done: '●',
  failed: '✗',
};

const JOB_COLORS: Record<string, string> = {
  planned: 'gray',
  ready: 'white',
  in_progress: 'cyan',
  review: 'yellow',
  done: 'green',
  failed: 'red',
};

interface JobBoardPanelProps {
  jobs: TeamJobInfo[];
}

export function JobBoardPanel({ jobs }: JobBoardPanelProps) {
  if (jobs.length === 0) return <Text dimColor>No jobs planned yet</Text>;

  return (
    <Box flexDirection="column">
      <Text bold>JobBoard</Text>
      {jobs.map(job => (
        <Box key={job.id} gap={1}>
          <Text color={JOB_COLORS[job.status] ?? 'white'}>{JOB_ICONS[job.status] ?? '?'}</Text>
          <Text>{job.id}: {job.title}</Text>
          {job.assignee && <Text dimColor>({job.assignee})</Text>}
          {job.blockedBy.length > 0 && (
            <Text dimColor>blocked by {job.blockedBy.join(', ')}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
