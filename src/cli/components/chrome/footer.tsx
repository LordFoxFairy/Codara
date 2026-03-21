import React from 'react';
import {Text} from 'ink';
import type {CliLayoutMode} from '../../app/layout-mode';
import type {CliInteractionSurface} from '../../app/view-state';

interface FooterProps {
  layoutMode: CliLayoutMode;
  hasCommandOutput?: boolean;
  focusedSurface?: CliInteractionSurface;
}

export function describeFooter(
  layoutMode: CliLayoutMode,
  hasCommandOutput = false,
  focusedSurface: CliInteractionSurface = 'prompt',
): string {
  if (hasCommandOutput) {
    if (layoutMode === 'minimal') {
      return 'Esc close  ·  ↑↓ scroll  ·  Enter send';
    }
    return 'Esc close output  ·  ↑↓ scroll  ·  Enter send  ·  / commands';
  }

  if (focusedSurface === 'review') {
    if (layoutMode === 'minimal') {
      return 'Enter select  ·  Tab/Arrow  ·  Esc cancel';
    }
    return 'Enter to select  ·  Tab/Arrow keys to navigate  ·  Esc to cancel';
  }

  if (layoutMode === 'minimal') {
    return 'Enter send  ·  ? shortcuts  ·  Ctrl+C exit';
  }

  return 'Enter send  ·  Ctrl+C exit  ·  / commands  ·  Ctrl+T tasks  ·  Ctrl+O expand';
}

export function Footer({layoutMode, hasCommandOutput, focusedSurface}: FooterProps): React.JSX.Element {
  return (
    <Text dimColor wrap="truncate-end">
      {describeFooter(layoutMode, hasCommandOutput, focusedSurface)}
    </Text>
  );
}
