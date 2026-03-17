import {useEffect, useState} from 'react';
import type {CodaraRuntimeEvent} from '@/index';
import type {CliActiveTurn, CliRunState} from '../app/view-state';
import {theme} from '../utils/theme';

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
export const SPINNER_INTERVAL_MS = 80;

export interface StatusIndicatorInput {
  runState: CliRunState;
  activeTurn?: CliActiveTurn;
  latestRuntimeEvent?: CodaraRuntimeEvent;
}

export interface StatusIndicatorModel {
  banner?: string;
  status: string;
  color: string;
}

function buildSpinnerBanner(label: string, frame: number): string {
  const spinner = BRAILLE_FRAMES[((frame % BRAILLE_FRAMES.length) + BRAILLE_FRAMES.length) % BRAILLE_FRAMES.length];
  return `${spinner} ${label}`;
}

export function useStatusIndicator(input: StatusIndicatorInput): StatusIndicatorModel {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (input.runState.status !== 'running') {
      return;
    }

    const timer = setInterval(() => {
      setFrame((current) => current + 1);
    }, SPINNER_INTERVAL_MS);

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
            banner: buildSpinnerBanner('Responding...', frame),
            status: 'Responding',
            color: theme.status.responding,
          };
        }

        return {
          banner: buildSpinnerBanner('Thinking...', frame),
          status: 'Thinking',
          color: theme.status.thinking,
        };
      }

      if (activeEventLabel) {
        return {
          banner: buildSpinnerBanner(activeEventLabel, frame),
          status: activeEventLabel,
          color: latestRuntimeEvent?.kind === 'command' || latestRuntimeEvent?.kind === 'summary'
            ? theme.status.paused
            : theme.status.running,
        };
      }

      if (activeTurn?.response.trim()) {
        return {
          banner: buildSpinnerBanner('Responding...', frame),
          status: 'Responding',
          color: theme.status.responding,
        };
      }

      return {
        banner: buildSpinnerBanner('Thinking...', frame),
        status: 'Thinking',
        color: theme.status.thinking,
      };
    case 'paused':
      return {
        banner: latestRuntimeEvent?.label?.trim()
          ? `⏺ ${latestRuntimeEvent.label.trim()}`
          : '⏺ Waiting for input',
        status: latestRuntimeEvent?.label?.trim() || 'Waiting',
        color: theme.status.paused,
      };
    case 'done':
      return {
        status: 'Ready',
        color: theme.status.done,
      };
    case 'error':
      return {
        banner: '✕ Review the latest error',
        status: 'Error',
        color: theme.status.error,
      };
    case 'idle':
    default:
      return {
        status: 'Ready',
        color: theme.status.idle,
      };
  }
}
