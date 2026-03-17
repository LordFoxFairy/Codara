import React from 'react';
import {Box} from 'ink';
import type {CliLayoutMode} from '../../app/layout-mode';
import type {SolidifiedItem} from '../../transcript/model';
import {StaticWelcome} from './welcome-state';
import {TranscriptBlock, ToolResultBlock} from './transcript';

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
      {turn.items.map((item) =>
        item.toolMeta ? (
          <ToolResultBlock key={item.id} meta={item.toolMeta} />
        ) : (
          <TranscriptBlock key={item.id} role={item.role} content={item.content} renderHint={item.renderHint} tokenAnnotation={item.tokenAnnotation} />
        ),
      )}
    </Box>
  );
}
