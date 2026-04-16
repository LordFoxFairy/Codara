import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import {SPINNER_INTERVAL_MS, theme} from '../../utils/theme';

const BLINK_FRAMES = ['●', '◉', '●', '●', '◉', '●', '●', '●'] as const;

interface RobotMarkProps {
  isRunning?: boolean;
}

export function RobotMark({isRunning}: RobotMarkProps): React.JSX.Element {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      setFrame((f) => f + 1);
    }, SPINNER_INTERVAL_MS * 3);
    return () => clearInterval(timer);
  }, [isRunning]);

  const eye = isRunning
    ? BLINK_FRAMES[frame % BLINK_FRAMES.length]!
    : '●';

  const tvLines = [
    ' ▄██████▄ ',
    ` █ ${eye}  ${eye} █ `,
    ' █  ──  █ ',
    ' ▀██████▀ ',
    '  ██  ██  ',
  ];

  return (
    <Box flexDirection="column" width={10} marginRight={2} flexShrink={0}>
      {tvLines.map((line, index) => (
        <Text key={`tv-${index}`} color={theme.chrome.mascot}>
          {line}
        </Text>
      ))}
    </Box>
  );
}
