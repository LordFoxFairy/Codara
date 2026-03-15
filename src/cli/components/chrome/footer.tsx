import React from 'react';
import {Text} from 'ink';
import type {CliLayoutMode} from '../../app/layout-mode';

interface FooterProps {
  layoutMode: CliLayoutMode;
}

export function describeFooter(layoutMode: CliLayoutMode): string {
  if (layoutMode === 'minimal') {
    return 'Enter send  ·  ? shortcuts  ·  Ctrl+C exit';
  }

  return 'Enter send  ·  Ctrl+C exit  ·  / commands  ·  Ctrl+T tasks';
}

export function Footer({layoutMode}: FooterProps): React.JSX.Element {
  return (
    <Text dimColor wrap="truncate-end">
      {describeFooter(layoutMode)}
    </Text>
  );
}
