import React from 'react';
import {Box, Text, useInput} from 'ink';
import type {SessionPickerItem} from '../../hooks/use-session-picker';
import {formatTokenCount} from '../../utils/format';
import {theme} from '../../utils/theme';

export interface SessionPickerProps {
  sessions: SessionPickerItem[];
  loading: boolean;
  selectedIndex: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSelect: () => void;
  onCancel: () => void;
}

export function SessionPicker({
  sessions,
  loading,
  selectedIndex,
  onMoveUp,
  onMoveDown,
  onSelect,
  onCancel,
}: SessionPickerProps): React.JSX.Element | null {
  // Keyboard handling lives here — no leaking to parent
  useInput((_input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.return) { onSelect(); return; }
    if (key.upArrow) { onMoveUp(); return; }
    if (key.downArrow) { onMoveDown(); return; }
  }, {isActive: true});

  if (loading) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.chrome.border} paddingX={1}>
        <Text color="cyan" bold>Resume Session</Text>
        <Text dimColor>Loading sessions…</Text>
      </Box>
    );
  }

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.chrome.border} paddingX={1}>
        <Text color="cyan" bold>Resume Session</Text>
        <Text dimColor>No sessions found. Press Esc to cancel.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.chrome.border} paddingX={1}>
      {/* Title bar */}
      <Box justifyContent="space-between">
        <Text bold color="cyan">Resume Session</Text>
        <Text dimColor>↑↓ navigate  enter select  esc cancel</Text>
      </Box>

      {sessions.map((session, index) => {
        const selected = index === selectedIndex;
        const pointer = selected ? '›' : ' ';
        const statsSegments: string[] = [];
        statsSegments.push(`${session.messageCount} msgs`);
        if (session.totalTokens) {
          statsSegments.push(`${formatTokenCount(session.totalTokens)} tok`);
        }
        statsSegments.push(session.timeAgo);
        const stats = statsSegments.join(' · ');

        return (
          <Box key={session.sessionId} flexDirection="column">
            <Box gap={1}>
              <Text color={selected ? 'greenBright' : undefined} bold={selected}>
                {pointer}
              </Text>
              <Text color={selected ? 'white' : undefined} bold={selected} wrap="truncate-end">
                {session.title}
              </Text>
              <Text dimColor>{stats}</Text>
            </Box>
            {selected && session.subtitle && (
              <Box paddingLeft={3}>
                <Text dimColor wrap="truncate-end">⎿ {session.subtitle}</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
