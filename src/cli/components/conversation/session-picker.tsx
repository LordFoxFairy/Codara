import React from 'react';
import {Box, Text} from 'ink';
import type {SessionPickerItem} from '../../hooks/use-session-picker';

export interface SessionPickerProps {
  sessions: SessionPickerItem[];
  loading: boolean;
  selectedIndex: number;
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
}

export function SessionPicker({sessions, loading, selectedIndex}: SessionPickerProps): React.JSX.Element | null {
  if (loading) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="cyan" bold>Select a session to resume</Text>
        <Text dimColor>Loading sessions...</Text>
      </Box>
    );
  }

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="cyan" bold>Select a session to resume</Text>
        <Text dimColor>No sessions found.</Text>
        <Text dimColor>Press Esc to cancel.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="cyan" bold>Select a session to resume</Text>
      <Box flexDirection="column" marginTop={1}>
        {sessions.map((session, index) => {
          const selected = index === selectedIndex;
          return (
            <Box key={session.sessionId} gap={1}>
              <Text color={selected ? 'greenBright' : undefined} bold={selected}>
                {selected ? '>' : ' '}
              </Text>
              <Text color={selected ? 'greenBright' : 'gray'}>
                {session.truncatedId}
              </Text>
              <Text color={selected ? 'white' : undefined} bold={selected} wrap="truncate-end">
                {session.title}
              </Text>
              <Text dimColor>{session.messageCount} msgs</Text>
              <Text dimColor>{session.timeAgo}</Text>
            </Box>
          );
        })}
      </Box>
      <Text dimColor>Arrow keys to navigate · Enter to select · Esc to cancel</Text>
    </Box>
  );
}
