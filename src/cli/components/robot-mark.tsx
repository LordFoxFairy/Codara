import React from 'react';
import {Box, Text} from 'ink';

const ROBOT_LINES = [
  '  ▄████▄  ',
  ' █ ████ █ ',
  '██████████',
  '██ ▀  ▀ ██',
  '██ ████ ██',
  ' █  ██  █ ',
  '  █ ██ █  ',
  '  ▀▀  ▀▀  ',
];

export function RobotMark(): React.JSX.Element {
  return (
    <Box flexDirection="column" width={10} marginRight={2} flexShrink={0}>
      {ROBOT_LINES.map(line => (
        <Text key={line} color="yellowBright">
          {line}
        </Text>
      ))}
    </Box>
  );
}
