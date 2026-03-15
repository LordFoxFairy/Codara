import React from 'react';
import {Box, Text} from 'ink';
import type {CliLayoutMode} from '../../app/layout-mode';
import {RobotMark} from '../chrome/robot-mark';
import {useRotatingTip} from '../../hooks/use-rotating-tip';
import {useTerminalWidth} from '../../hooks/use-terminal-width';

interface WelcomeStateProps {
  layoutMode: CliLayoutMode;
  cwd?: string;
  modelAlias?: string;
}

const VERSION = '0.1.0';

export function WelcomeState({layoutMode, cwd, modelAlias}: WelcomeStateProps): React.JSX.Element {
  if (layoutMode === 'minimal') {
    return (
      <Box marginTop={1}>
        <Text dimColor>Codara · {modelAlias || 'default'} · Ready</Text>
      </Box>
    );
  }

  if (layoutMode === 'compact') {
    return <CompactWelcome cwd={cwd} modelAlias={modelAlias} />;
  }

  return <WideWelcome cwd={cwd} modelAlias={modelAlias} />;
}

function CompactWelcome({cwd, modelAlias}: {cwd?: string; modelAlias?: string}): React.JSX.Element {
  const tip = useRotatingTip();
  const width = useTerminalWidth();
  const availableWidth = Math.max(20, width - 2);
  const titleText = ` Codara v${VERSION} `;
  const topRemaining = Math.max(0, availableWidth - 2 - titleText.length);
  const topLine = `──${titleText}${'─'.repeat(topRemaining)}`;
  const bottomLine = '─'.repeat(availableWidth);

  return (
    <Box flexDirection="column">
      <Text color="gray">{topLine}</Text>
      <Box flexDirection="column" paddingX={2} paddingY={1} alignItems="center">
        <Text bold color="white">Welcome back!</Text>
        <Box marginTop={1}>
          <RobotMark />
        </Box>
        {modelAlias ? <Text dimColor>{modelAlias}</Text> : null}
        {cwd ? <Text dimColor wrap="truncate-end">{cwd}</Text> : null}
      </Box>
      <Text color="gray">{bottomLine}</Text>
      <Box marginTop={1} flexDirection="column" paddingX={1}>
        <Text color="yellow" bold>Tip</Text>
        <Text dimColor>{tip}</Text>
      </Box>
    </Box>
  );
}

function WideWelcome({cwd, modelAlias}: {cwd?: string; modelAlias?: string}): React.JSX.Element {
  const tip = useRotatingTip();

  return (
    <Box flexDirection="column">
      {/* Outer box: Ink handles all borders, corners, and sizing automatically */}
      <Box
        borderStyle="round"
        borderColor="gray"
        flexDirection="row"
      >
        {/* Left column — borderRight creates the middle │ divider */}
        <Box
          flexDirection="column"
          width="42%"
          alignItems="center"
          paddingY={1}
          paddingX={1}
          borderStyle="round"
          borderColor="gray"
          borderRight
          borderLeft={false}
          borderTop={false}
          borderBottom={false}
        >
          <Text bold color="white">Welcome back!</Text>
          <Box marginTop={1}>
            <RobotMark />
          </Box>
          <Text dimColor>{modelAlias || 'default'}</Text>
          {cwd ? <Text dimColor wrap="truncate-end">{cwd}</Text> : null}
        </Box>

        {/* Right column */}
        <Box flexDirection="column" flexGrow={1} paddingY={1} paddingX={1}>
          <Text color="yellow" bold>Tips for getting started</Text>
          <Text dimColor wrap="truncate-end">{tip}</Text>
          <Box marginTop={1} flexDirection="column">
            <Text color="yellow" bold>Recent activity</Text>
            <Text dimColor>No recent activity</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
