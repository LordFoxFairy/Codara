import { Box, Text } from 'ink';
import type { TeamActivityItem } from '../../hooks/use-team-detail.js';

interface TeamActivityLogProps {
  activity: TeamActivityItem[];
  maxItems?: number;
}

export function TeamActivityLog({ activity, maxItems = 10 }: TeamActivityLogProps) {
  const visible = activity.slice(-maxItems);

  if (visible.length === 0) return <Text dimColor>No activity yet</Text>;

  return (
    <Box flexDirection="column">
      <Text bold>Recent Activity</Text>
      {visible.map((item, i) => {
        const time = formatTime(item.timestamp);
        return (
          <Box key={i} gap={1}>
            <Text dimColor>{time}</Text>
            <Text bold>{item.actor}:</Text>
            <Text>{item.action}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  } catch {
    return '--:--';
  }
}
