// src/cli/components/permission/ToolCallDisplay.tsx

import React from 'react';
import {Box, Text} from 'ink';

interface ToolCallDisplayProps {
  toolName: string;
  toolArgs: Record<string, unknown>;
}

/**
 * Renders a tool call in a format appropriate for the tool type.
 * - Bash: `$ command` format
 * - Edit/Write: file path + diff preview
 * - Read: file path
 * - Fetch/Search: URL/query
 */
export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({toolName, toolArgs}) => {
  const norm = toolName.trim().toLowerCase();

  if (norm === 'bash') {
    const command = typeof toolArgs.command === 'string' ? toolArgs.command : '';
    return (
      <Box flexDirection="column">
        <Text bold color="yellow">{`# Bash`}</Text>
        <Text color="cyan">{`$ ${command}`}</Text>
      </Box>
    );
  }

  if (norm === 'edit_file' || norm === 'write_file') {
    const filePath = typeof toolArgs.file_path === 'string' ? toolArgs.file_path : '';
    const label = norm === 'edit_file' ? 'Edit' : 'Write';
    return (
      <Box flexDirection="column">
        <Text bold color="yellow">{`# ${label}`}</Text>
        <Text dimColor>{filePath}</Text>
      </Box>
    );
  }

  if (norm === 'read_file') {
    const filePath = typeof toolArgs.file_path === 'string'
      ? toolArgs.file_path
      : typeof toolArgs.path === 'string' ? toolArgs.path : '';
    return (
      <Box flexDirection="column">
        <Text bold color="yellow">{`# Read`}</Text>
        <Text dimColor>{filePath}</Text>
      </Box>
    );
  }

  if (norm === 'fetch_url') {
    const url = typeof toolArgs.url === 'string' ? toolArgs.url : '';
    return (
      <Box flexDirection="column">
        <Text bold color="yellow">{`# Fetch`}</Text>
        <Text dimColor>{url}</Text>
      </Box>
    );
  }

  if (norm === 'web_search') {
    const query = typeof toolArgs.query === 'string' ? toolArgs.query : '';
    return (
      <Box flexDirection="column">
        <Text bold color="yellow">{`# Search`}</Text>
        <Text dimColor>{query}</Text>
      </Box>
    );
  }

  // Generic display
  const summary = Object.entries(toolArgs)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .slice(0, 2)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`)
    .join(', ');

  return (
    <Box flexDirection="column">
      <Text bold color="yellow">{`# ${toolName}`}</Text>
      {summary ? <Text dimColor>{summary}</Text> : null}
    </Box>
  );
};
