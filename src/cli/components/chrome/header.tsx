import React from 'react';
import {Box, Text} from 'ink';
import type {SessionState} from '@core';
import type {CliLayoutMode} from '../../app/layout-mode';
import type {CliRunState} from '../../app/view-state';
import {RobotMark} from './robot-mark';

interface HeaderProps {
  cwd: string;
  layoutMode: CliLayoutMode;
  session: SessionState;
  modelAlias: string;
  runState: CliRunState;
}

function MetaRow({
  label,
  value,
  valueWrap = 'truncate-end',
}: {
  label: string;
  value: string;
  valueWrap?: 'truncate-end' | 'truncate-middle';
}): React.JSX.Element {
  return (
    <Box>
      <Box width={8} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap={valueWrap}>{value}</Text>
      </Box>
    </Box>
  );
}

export function Header(props: HeaderProps): React.JSX.Element {
  const {cwd, layoutMode, session, modelAlias, runState} = props;
  const isCompact = layoutMode !== 'wide';
  const isMinimal = layoutMode === 'minimal';
  const title = session.metadata?.title?.trim() || 'Codara Code';
  const subtitle = session.metadata?.lastMessage?.trim() || 'Session ready for prompts';
  const messageCount = String(session.metadata?.messageCount ?? 0);

  return (
    <Box flexDirection={isCompact ? 'column' : 'row'}>
      {!isMinimal ? (
        <Box flexShrink={0}>
          <RobotMark />
        </Box>
      ) : null}
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text color="blueBright" wrap="truncate-end">
          {title}
        </Text>
        <Text dimColor wrap="truncate-end">
          {subtitle}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <MetaRow label="Model" value={modelAlias} />
          {!isMinimal ? <MetaRow label="Route" value={modelAlias} /> : null}
          {!isMinimal ? <MetaRow label="Session" value={session.sessionId} valueWrap="truncate-middle" /> : null}
          {!isMinimal ? <MetaRow label="Msgs" value={messageCount} /> : null}
          <MetaRow label="Status" value={runState.status} />
          <MetaRow label="Path" value={cwd} valueWrap="truncate-middle" />
        </Box>
      </Box>
    </Box>
  );
}
