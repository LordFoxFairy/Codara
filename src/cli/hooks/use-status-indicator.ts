import {useEffect, useState} from 'react';
import type {CliActiveTurn, CliRunState} from '../app/view-state';

const THINKING_FRAMES = ['✳ Thinking', '✳ Thinking.', '✳ Thinking..', '✳ Thinking...'];
const RESPONDING_FRAMES = ['⏺ Responding', '⏺ Responding.', '⏺ Responding..', '⏺ Responding...'];
const FRAME_INTERVAL_MS = 220;

export interface StatusIndicatorInput {
  runState: CliRunState;
  activeTurn?: CliActiveTurn;
  hilBusy?: boolean;
}

export interface StatusIndicatorModel {
  banner?: string;
  status: string;
  color: 'yellow' | 'blueBright' | 'green' | 'gray' | 'red';
}

export function useStatusIndicator(input: StatusIndicatorInput): StatusIndicatorModel {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (input.runState.status !== 'running') {
      setFrame(0);
      return;
    }

    const timer = setInterval(() => {
      setFrame((current) => current + 1);
    }, FRAME_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [input.runState.status]);

  return describeStatusIndicator(input, frame);
}

export function describeStatusIndicator(input: StatusIndicatorInput, frame = 0): StatusIndicatorModel {
  const {runState, activeTurn, hilBusy} = input;

  if (hilBusy) {
    return {
      banner: '⏺ Applying selection',
      status: 'Applying',
      color: 'blueBright',
    };
  }

  switch (runState.status) {
    case 'running':
      if (activeTurn?.response.trim()) {
        return {
          banner: cycle(RESPONDING_FRAMES, frame),
          status: 'Responding',
          color: 'green',
        };
      }

      return {
        banner: cycle(THINKING_FRAMES, frame),
        status: 'Thinking',
        color: 'yellow',
      };
    case 'paused':
      return {
        banner: '⏺ Waiting for input',
        status: 'Waiting',
        color: 'blueBright',
      };
    case 'done':
      return {
        banner: '✓ Ready for next prompt',
        status: 'Ready',
        color: 'green',
      };
    case 'error':
      return {
        banner: '✕ Review the latest error',
        status: 'Error',
        color: 'red',
      };
    case 'idle':
    default:
      return {
        status: 'Ready',
        color: 'gray',
      };
  }
}

function cycle(frames: readonly string[], frame: number): string {
  const normalized = ((frame % frames.length) + frames.length) % frames.length;
  return frames[normalized]!;
}
