import React from 'react';
import {Box, Text} from 'ink';
import type {CliLayoutMode} from '../app/layout-mode';
import type {CliRunState, CliSessionMeta} from '../state/shell-types';
import {RobotMark} from './robot-mark';

interface HeaderProps {
  cwd: string;
  layoutMode: CliLayoutMode;
  meta: CliSessionMeta;
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
  const {cwd, layoutMode, meta, runState} = props;
  const status = runState.error ? `${runState.status} (${runState.error})` : runState.status;
  const isCompact = layoutMode !== 'wide';
  const isMinimal = layoutMode === 'minimal';

  return (
    <Box flexDirection={isCompact ? 'column' : 'row'}>
      {!isMinimal ? (
        <Box flexShrink={0}>
          <RobotMark />
        </Box>
      ) : null}
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text color="blueBright" wrap="truncate-end">
          {meta.title}
        </Text>
        <Text dimColor wrap="truncate-end">
          {meta.subtitle}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <MetaRow label="Model" value={meta.model} />
          {!isMinimal ? <MetaRow label="Route" value={meta.route} /> : null}
          {!isMinimal ? <MetaRow label="Mode" value={meta.mode} /> : null}
          {!isMinimal ? <MetaRow label="Session" value={meta.session} /> : null}
          <MetaRow label="Status" value={status} />
          <MetaRow label="Path" value={cwd} valueWrap="truncate-middle" />
        </Box>
      </Box>
    </Box>
  );
}
