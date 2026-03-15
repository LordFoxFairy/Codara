import {useEffect, useState} from 'react';
import type {CodaraRuntimeEvent} from '@core';
import type {CliActiveTurn, CliRunState} from '../app/view-state';

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const THINKING_FRAMES = BRAILLE_FRAMES.map((f) => `${f} Thinking...`);
const RESPONDING_FRAMES = BRAILLE_FRAMES.map((f) => `${f} Responding...`);
const FRAME_INTERVAL_MS = 80;

export interface StatusIndicatorInput {
  runState: CliRunState;
  activeTurn?: CliActiveTurn;
  latestRuntimeEvent?: CodaraRuntimeEvent;
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
      return;
    }

    const timer = setInterval(() => {
      setFrame((current) => current + 1);
    }, FRAME_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [input.runState.status]);

  return describeStatusIndicator(input, input.runState.status === 'running' ? frame : 0);
}

export function describeStatusIndicator(input: StatusIndicatorInput, frame = 0): StatusIndicatorModel {
  const {runState, activeTurn, latestRuntimeEvent} = input;
  const activeEventLabel = latestRuntimeEvent?.label?.trim();

  switch (runState.status) {
    case 'running':
      if (latestRuntimeEvent?.kind === 'model') {
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
      }

      if (activeEventLabel) {
        const spinner = spinnerFrame(frame);
        return {
          banner: `${spinner} ${activeEventLabel}`,
          status: activeEventLabel,
          color: latestRuntimeEvent?.kind === 'command' || latestRuntimeEvent?.kind === 'summary'
            ? 'blueBright'
            : 'yellow',
        };
      }

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
        banner: latestRuntimeEvent?.label?.trim()
          ? `⏺ ${latestRuntimeEvent.label.trim()}`
          : '⏺ Waiting for input',
        status: latestRuntimeEvent?.label?.trim() || 'Waiting',
        color: 'blueBright',
      };
    case 'done':
      return {
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

function spinnerFrame(frame: number): string {
  return BRAILLE_FRAMES[((frame % BRAILLE_FRAMES.length) + BRAILLE_FRAMES.length) % BRAILLE_FRAMES.length]!;
}
