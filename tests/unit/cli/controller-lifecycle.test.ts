import {describe, expect, it} from 'bun:test';
import type {CodaraRuntimeEvent} from '@/index';
import {
  appendCliRuntimeEvent,
  MAX_CLI_RUNTIME_EVENTS,
  shouldAutoSubmitInitialPrompt,
} from '@/cli/app/controller-lifecycle';

describe('CLI controller lifecycle helpers', () => {
  it('keeps only the latest runtime events in the event log', () => {
    let events: readonly CodaraRuntimeEvent[] = [];

    for (let index = 0; index < MAX_CLI_RUNTIME_EVENTS + 5; index += 1) {
      events = appendCliRuntimeEvent(events, createRuntimeEvent(index));
    }

    expect(events).toHaveLength(MAX_CLI_RUNTIME_EVENTS);
    expect(events[0]?.type).toBe('step-end');
    expect(events.at(-1)?.type).toBe('step-end');
    expect((events[0] as {step?: number}).step).toBe(5);
    expect((events.at(-1) as {step?: number} | undefined)?.step).toBe(MAX_CLI_RUNTIME_EVENTS + 4);
  });

  it('only auto-submits the first non-blank initial prompt', () => {
    expect(shouldAutoSubmitInitialPrompt('', false)).toBe(false);
    expect(shouldAutoSubmitInitialPrompt('   ', false)).toBe(false);
    expect(shouldAutoSubmitInitialPrompt('hello', true)).toBe(false);
    expect(shouldAutoSubmitInitialPrompt('hello', false)).toBe(true);
  });
});

function createRuntimeEvent(step: number): CodaraRuntimeEvent {
  return {
    type: 'step-end',
    step,
  } as CodaraRuntimeEvent;
}
