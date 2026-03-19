import {useEffect, useState} from 'react';
import type {CodaraRuntimeEvent} from '@/index';
import type {CliActiveTurn, CliRunState} from '../app/view-state';
import {theme} from '../utils/theme';

const SPINNER_FRAMES = ['-', '\\', '|', '/'] as const;
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
  const spinner = SPINNER_FRAMES[((frame % SPINNER_FRAMES.length) + SPINNER_FRAMES.length) % SPINNER_FRAMES.length];
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

function truncateLabel(label: string | undefined, maxLength = 60): string | undefined {
  if (!label) {
    return undefined;
  }

  let text = label.split('\n')[0]!.trim();
  if (text.startsWith('Delegating ')) {
    text = text.slice('Delegating '.length);
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

export function describeStatusIndicator(input: StatusIndicatorInput, frame = 0): StatusIndicatorModel {
  const {runState, activeTurn, latestRuntimeEvent} = input;
  const activeEventLabel = truncateLabel(latestRuntimeEvent?.label);

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
        const isTask = latestRuntimeEvent?.kind === 'task';
        const isTool = latestRuntimeEvent?.kind === 'tool';
        const statusWord = isTask ? 'delegating' : isTool ? activeEventLabel : activeEventLabel;
        const shortStatus = statusWord.length > 30 ? `${statusWord.slice(0, 27)}...` : statusWord;
        return {
          banner: buildSpinnerBanner(activeEventLabel, frame),
          status: shortStatus,
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
    case 'paused': {
      const pausedLabel = truncateLabel(latestRuntimeEvent?.label);
      return {
        banner: pausedLabel ? `[pause] ${pausedLabel}` : '[pause] Waiting for input',
        status: pausedLabel || 'Waiting',
        color: theme.status.paused,
      };
    }
    case 'done':
      return {
        status: 'Ready',
        color: theme.status.done,
      };
    case 'error':
      return {
        banner: '[error] Review the latest error',
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
