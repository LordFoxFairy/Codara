import React from 'react';
import {Box, Text} from 'ink';
import type {CliLayoutMode} from '../../app/layout-mode';

interface FooterProps {
  layoutMode: CliLayoutMode;
}

export function describeFooter(layoutMode: CliLayoutMode): string {
  if (layoutMode === 'minimal') {
    return '? shortcuts  ·  tab thinking  ·  auto-update on';
  }

  return 'Ctrl+C exit  ·  ? shortcuts  ·  tab thinking  ·  auto-update on';
}

export function Footer({layoutMode}: FooterProps): React.JSX.Element {
  return (
    <Box marginTop={1}>
      <Text dimColor wrap="truncate-end">
        {describeFooter(layoutMode)}
      </Text>
    </Box>
  );
}
