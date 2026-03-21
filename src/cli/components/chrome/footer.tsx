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
      return 'Esc close · ↑↓ scroll · Enter send';
    }
    return 'Esc close output · ↑↓ scroll · Enter send · / commands';
  }

  if (layoutMode === 'minimal') {
    return 'Enter send · ? shortcuts · Ctrl+C exit';
  }

  const base = 'Enter send · Ctrl+C exit · / commands · Ctrl+T tasks · Ctrl+O expand';
  if (hasActiveTeams) {
    return `${base} · shift+↑↓ select member`;
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
