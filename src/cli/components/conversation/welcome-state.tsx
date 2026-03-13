import React from 'react';
import {Box, Text} from 'ink';
import type {CliLayoutMode} from '../../app/layout-mode';

interface WelcomeStateProps {
  layoutMode: CliLayoutMode;
}

export function WelcomeState({layoutMode}: WelcomeStateProps): React.JSX.Element {
  const suggestion = layoutMode === 'minimal'
    ? 'Try "fix lint errors"'
    : 'Try "review the latest diff"';

  return (
    <Box marginTop={1} flexDirection="column">
      <Text dimColor>Ask for a review, fix, or explanation.</Text>
      <Text dimColor wrap="truncate-end">{suggestion}</Text>
    </Box>
  );
}
