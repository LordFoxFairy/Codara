import React from 'react';
import {Box} from 'ink';
import type {CliLayoutMode} from '../../app/layout-mode';
import type {SolidifiedItem} from './model';
import {StaticWelcome} from '../../components/conversation/welcome-state';
import {TranscriptItemsView} from './render';

interface SolidifiedBlockProps {
  turn: SolidifiedItem;
  layoutMode: CliLayoutMode;
  cwd?: string;
  modelAlias?: string;
  tip: string;
  expandedAll?: boolean;
  subagentDetails?: ReadonlyMap<string, import('./model').TranscriptItem[]>;
}

export function SolidifiedBlock({turn, layoutMode, cwd, modelAlias, tip, expandedAll = false, subagentDetails}: SolidifiedBlockProps): React.JSX.Element {
  if (turn.kind === 'welcome') {
    return <StaticWelcome layoutMode={layoutMode} cwd={cwd} modelAlias={modelAlias} tip={tip} />;
  }

  return (
    <Box flexDirection="column">
      <TranscriptItemsView items={turn.items} expandedAll={expandedAll} subagentDetails={subagentDetails} />
    </Box>
  );
}
