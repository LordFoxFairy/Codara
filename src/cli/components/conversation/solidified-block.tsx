import React from 'react';
import {Box} from 'ink';
import type {CliLayoutMode} from '../../app/layout-mode';
import type {SolidifiedItem} from '../../transcript/model';
import {StaticWelcome} from './welcome-state';
import {TranscriptItemsView} from './transcript';

interface SolidifiedBlockProps {
  turn: SolidifiedItem;
  layoutMode: CliLayoutMode;
  cwd?: string;
  modelAlias?: string;
  tip: string;
}

export function SolidifiedBlock({turn, layoutMode, cwd, modelAlias, tip}: SolidifiedBlockProps): React.JSX.Element {
  if (turn.kind === 'welcome') {
    return <StaticWelcome layoutMode={layoutMode} cwd={cwd} modelAlias={modelAlias} tip={tip} />;
  }

  return (
    <Box flexDirection="column">
      <TranscriptItemsView items={turn.items} />
    </Box>
  );
}
