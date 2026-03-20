import type {CodaraRuntimeEvent} from '@/index';
import type {CliActiveTurn, CliRunState} from '../app/view-state';
import {theme} from '../utils/theme';

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

export function useStatusIndicator(input: StatusIndicatorInput): StatusIndicatorModel {
  return describeStatusIndicator(input);
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

export function describeStatusIndicator(input: StatusIndicatorInput): StatusIndicatorModel {
  const {runState, activeTurn, latestRuntimeEvent} = input;
  const activeEventLabel = truncateLabel(latestRuntimeEvent?.label);

  switch (runState.status) {
    case 'running':
      if (latestRuntimeEvent?.kind === 'model') {
        if (activeTurn?.response.trim()) {
          return {
            banner: 'Responding...',
            status: 'Responding',
            color: theme.status.responding,
          };
        }

        return {
          banner: 'Thinking...',
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
          banner: activeEventLabel,
          status: shortStatus,
          color: latestRuntimeEvent?.kind === 'command' || latestRuntimeEvent?.kind === 'summary'
            ? theme.status.paused
            : theme.status.running,
        };
      }

      if (activeTurn?.response.trim()) {
        return {
          banner: 'Responding...',
          status: 'Responding',
          color: theme.status.responding,
        };
      }

      return {
        banner: 'Thinking...',
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
