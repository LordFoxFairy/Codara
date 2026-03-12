import React from 'react';
import {Box, Text} from 'ink';
import type {CliLayoutMode} from '../app/layout-mode';

interface WelcomeStateProps {
  layoutMode: CliLayoutMode;
}

export function WelcomeState({layoutMode}: WelcomeStateProps): React.JSX.Element {
  const description =
    layoutMode === 'minimal'
      ? 'Minimal startup view for narrow terminals.'
      : layoutMode === 'compact'
        ? 'Runtime details stay visible while the startup surface stays compact.'
        : 'Welcome UI stays minimal and neutral. Runtime details are visible, but no workflow is hardcoded into the startup surface.';

  return (
    <Box marginTop={1} flexDirection="column">
      <Text>Ready for the first prompt.</Text>
      <Text dimColor wrap="truncate-end">
        {description}
      </Text>
    </Box>
  );
}
