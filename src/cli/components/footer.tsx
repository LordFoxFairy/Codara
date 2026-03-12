import React from 'react';
import {Box, Text} from 'ink';
import type {CliLayoutMode} from '../app/layout-mode';
import {AUTO_UPDATE_HINT, SHORTCUTS_HINT, THINKING_HINT} from '../adapters/session-meta';

interface FooterProps {
  layoutMode: CliLayoutMode;
}

export function Footer({layoutMode}: FooterProps): React.JSX.Element {
  const shortcutsHint = layoutMode === 'minimal' ? '?' : SHORTCUTS_HINT;
  const thinkingHint = layoutMode === 'minimal' ? 'Thinking off' : THINKING_HINT;
  const updateHint = layoutMode === 'minimal' ? 'Auto-update on' : AUTO_UPDATE_HINT;

  return (
    <Box marginTop={1} flexDirection="column">
      <Text dimColor wrap="truncate-end">
        {shortcutsHint}
      </Text>
      <Text dimColor wrap="truncate-end">
        {thinkingHint}
      </Text>
      <Text dimColor wrap="truncate-end">
        {updateHint}
      </Text>
    </Box>
  );
}
