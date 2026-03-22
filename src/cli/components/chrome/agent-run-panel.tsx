import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import type {ActiveAgentRun} from '../../hooks/use-agent-runs';
import {SPINNER_INTERVAL_MS} from '../../hooks/use-status-indicator';
import {theme} from '../../utils/theme';

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

interface AgentRunPanelProps {
  runs: ActiveAgentRun[];
  runningCount: number;
  pausedCount: number;
  doneCount: number;
  errorCount: number;
  hiddenCount?: number;
}

function buildAgentRunSummary(runningCount: number, pausedCount: number, doneCount: number, errorCount: number): string {
  const parts: string[] = [];
  if (runningCount > 0) parts.push(`${runningCount} running`);
  if (pausedCount > 0) parts.push(`${pausedCount} paused`);
  if (doneCount > 0) parts.push(`${doneCount} done`);
  if (errorCount > 0) parts.push(`${errorCount} failed`);
  return parts.join(', ');
}

function AgentRunCheckbox({status, frame}: {status: ActiveAgentRun['status']; frame: number}): React.JSX.Element {
  switch (status) {
    case 'running': {
      const spinner = BRAILLE_FRAMES[((frame % BRAILLE_FRAMES.length) + BRAILLE_FRAMES.length) % BRAILLE_FRAMES.length];
      return <Text color={theme.status.running}>[{spinner}]</Text>;
    }
    case 'done':
      return <Text color={theme.status.done}>[✓]</Text>;
    case 'error':
      return <Text color={theme.status.error}>[✕]</Text>;
    case 'paused':
      return <Text color={theme.status.paused}>[⏸]</Text>;
  }
}

export function AgentRunPanel({
  runs,
  runningCount,
  pausedCount,
  doneCount,
  errorCount,
  hiddenCount = 0,
}: AgentRunPanelProps): React.JSX.Element | null {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (runningCount === 0) return;

    const timer = setInterval(() => {
      setFrame(current => current + 1);
    }, SPINNER_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [runningCount]);

  if (runs.length === 0) return null;

  const summary = buildAgentRunSummary(runningCount, pausedCount, doneCount, errorCount);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.chrome.border} paddingX={1}>
      <Text dimColor bold>Subagents ({summary})</Text>
      {runs.map((run) => {
        return (
          <Box key={run.id} gap={1}>
            <AgentRunCheckbox status={run.status} frame={frame} />
            <Text wrap="truncate-end">{run.name}</Text>
          </Box>
        );
      })}
      {hiddenCount > 0 ? (
        <Text dimColor>{`+${hiddenCount} more`}</Text>
      ) : null}
    </Box>
  );
}
