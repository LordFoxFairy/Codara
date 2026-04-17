/**
 * SubagentRunPanel -- displays a compact list of running/paused/done subagent
 * runs with animated spinners and status checkboxes.
 */
import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import type {ActiveSubagentRun} from './use-runs';
import {BRAILLE_FRAMES, SPINNER_INTERVAL_MS, theme} from '../../utils/theme';

interface SubagentRunPanelProps {
  runs: ActiveSubagentRun[];
  runningCount: number;
  pausedCount: number;
  doneCount: number;
  errorCount: number;
  hiddenCount?: number;
}

function buildSubagentRunSummary(runningCount: number, pausedCount: number, doneCount: number, errorCount: number): string {
  const parts: string[] = [];
  if (runningCount > 0) parts.push(`${runningCount} running`);
  if (pausedCount > 0) parts.push(`${pausedCount} paused`);
  if (doneCount > 0) parts.push(`${doneCount} done`);
  if (errorCount > 0) parts.push(`${errorCount} failed`);
  return parts.join(', ');
}

function SubagentRunCheckbox({status, frame}: {status: ActiveSubagentRun['status']; frame: number}): React.JSX.Element {
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

export function SubagentRunPanel({
  runs,
  runningCount,
  pausedCount,
  doneCount,
  errorCount,
  hiddenCount = 0,
}: SubagentRunPanelProps): React.JSX.Element | null {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (runningCount === 0) return;

    const timer = setInterval(() => {
      setFrame(current => current + 1);
    }, SPINNER_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [runningCount]);

  if (runs.length === 0) return null;

  const summary = buildSubagentRunSummary(runningCount, pausedCount, doneCount, errorCount);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.chrome.border} paddingX={1}>
      <Text dimColor bold>Subagents ({summary})</Text>
      {runs.map((run) => {
        return (
          <Box key={run.id} gap={1}>
            <SubagentRunCheckbox status={run.status} frame={frame} />
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
