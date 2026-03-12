import React from 'react';
import {Box, Text} from 'ink';
import type {CliLayoutMode} from '../../app/layout-mode';

const SHORTCUTS_HINT = '? for shortcuts';
const THINKING_HINT = 'Thinking off (tab to toggle)';
const AUTO_UPDATE_HINT = 'Auto-updating...';

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
