/**
 * Persistent spinner component.
 *
 * Shows a braille-frame spinner ONLY when runState.status === 'running'.
 * Independent of all other state -- no complex logic, no dependencies.
 * Lifecycle matches the main agent loop exactly.
 */
import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import type {CliRunState} from '../../app/view-state';
import {BRAILLE_FRAMES, SPINNER_INTERVAL_MS} from '../../utils/theme';

interface PersistentSpinnerProps {
  runState: CliRunState;
}

export function PersistentSpinner({runState}: PersistentSpinnerProps): React.JSX.Element {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (runState.status !== 'running') {
      return;
    }

    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % BRAILLE_FRAMES.length);
    }, SPINNER_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [runState.status]);

  // Only show when running - simple and reliable
  if (runState.status !== 'running') {
    return <Box height={1}><Text> </Text></Box>;
  }

  const spinner = BRAILLE_FRAMES[frame];

  return (
    <Box height={1}>
      <Text color="cyan">{spinner} Thinking...</Text>
    </Box>
  );
}
