import React from 'react';
import {Box, Text} from 'ink';

// Bilibili-style pixel TV mascot: block chars + face
const TV_LINES = [
  ' ▄██████▄ ',
  ' █ ●  ● █ ',
  ' █  ──  █ ',
  ' ▀██████▀ ',
  '  ██  ██  ',
];

export function RobotMark(): React.JSX.Element {
  return (
    <Box flexDirection="column" width={10} marginRight={2} flexShrink={0}>
      {TV_LINES.map((line, index) => (
        <Text key={`tv-${index}`} color="yellowBright">
          {line}
        </Text>
      ))}
    </Box>
  );
}
