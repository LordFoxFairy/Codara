import React from 'react';
import {Text} from 'ink';
import type {CliLayoutMode} from '../../app/layout-mode';

interface FooterProps {
  layoutMode: CliLayoutMode;
  hasCommandOutput?: boolean;
  hasActiveTeams?: boolean;
}

export function describeFooter(layoutMode: CliLayoutMode, hasCommandOutput = false, hasActiveTeams = false): string {
  if (hasCommandOutput) {
    if (layoutMode === 'minimal') {
      return 'Esc close | Up/Down scroll | Enter accept';
    }
    return 'Esc close output | Up/Down scroll | Enter accept | / commands';
  }

  if (layoutMode === 'minimal') {
    return 'Enter send | / commands | Ctrl+C exit';
  }

  const base = 'Enter send | / commands | Ctrl+T tasks | Ctrl+O expand | Ctrl+C exit';
  if (hasActiveTeams) {
    return `${base} | Shift+Up/Down member`;
  }
  return base;
}

export function Footer({layoutMode, hasCommandOutput, hasActiveTeams}: FooterProps): React.JSX.Element {
  return (
    <Text dimColor wrap="truncate-end">
      {describeFooter(layoutMode, hasCommandOutput, hasActiveTeams)}
    </Text>
  );
}
