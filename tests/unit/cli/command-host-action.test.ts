import {describe, expect, it} from 'bun:test';
import {handleCliCommandHostAction} from '@/cli/app/command-host-action';
import type {CliNotice, CliRunState} from '@/cli/app/view-state';
import type {CodaraCommandResult} from '@capability/command/runtime/types';

function createHarness(result: CodaraCommandResult) {
  const notices: Array<{level: CliNotice['level']; content: string}> = [];
  const runStates: CliRunState[] = [];
  const reopenCalls: string[] = [];
  const openFileCalls: string[] = [];
  let pickerShown = 0;

  return {
    notices,
    runStates,
    reopenCalls,
    openFileCalls,
    get pickerShown() {
      return pickerShown;
    },
    run: (overrides?: Partial<Parameters<typeof handleCliCommandHostAction>[0]>) => handleCliCommandHostAction({
      result,
      sessionId: 'current-session',
      appendNotice: (level, content) => {
        notices.push({level, content});
      },
      setRunState: (state) => {
        runStates.push(state);
      },
      reopenSession: async (sessionId) => {
        reopenCalls.push(sessionId);
      },
      openFile: async (targetPath) => {
        openFileCalls.push(targetPath);
        return true;
      },
      onShowSessionPicker: () => {
        pickerShown += 1;
      },
      ...overrides,
    }),
  };
}

describe('CLI command host action helper', () => {
  it('returns false when command result has no host action', async () => {
    const harness = createHarness({
      ok: true,
      command: 'help',
      output: 'ok',
    });

    expect(await harness.run()).toBe(false);
    expect(harness.notices).toEqual([]);
    expect(harness.runStates).toEqual([]);
  });

  it('shows the session picker when requested', async () => {
    const harness = createHarness({
      ok: true,
      command: 'resume',
      output: '',
      action: {type: 'show_session_picker'},
    });

    expect(await harness.run()).toBe(true);
    expect(harness.pickerShown).toBe(1);
    expect(harness.runStates).toEqual([{status: 'done'}]);
  });

  it('reopens a different session for resume_session actions', async () => {
    const harness = createHarness({
      ok: true,
      command: 'resume',
      output: 'Resuming target-session',
      action: {type: 'resume_session', sessionId: 'target-session'},
    });

    expect(await harness.run()).toBe(true);
    expect(harness.notices).toEqual([{level: 'system', content: 'Resuming target-session'}]);
    expect(harness.reopenCalls).toEqual(['target-session']);
    expect(harness.runStates).toEqual([]);
  });

  it('finishes immediately when resume_session targets the current session', async () => {
    const harness = createHarness({
      ok: true,
      command: 'resume',
      output: 'Already using session current-session.',
      action: {type: 'resume_session', sessionId: 'current-session'},
    });

    expect(await harness.run()).toBe(true);
    expect(harness.runStates).toEqual([{status: 'done'}]);
  });

  it('routes open_file through the host and reports the opened path', async () => {
    const harness = createHarness({
      ok: true,
      command: 'permissions',
      output: 'Open the file',
      action: {type: 'open_file', path: 'C:/project/.codara/settings.local.json'},
    });

    expect(await harness.run()).toBe(true);
    expect(harness.openFileCalls).toEqual(['C:/project/.codara/settings.local.json']);
    expect(harness.notices).toEqual([{
      level: 'system',
      content: 'Opened C:/project/.codara/settings.local.json',
    }]);
    expect(harness.runStates).toEqual([{status: 'done'}]);
  });

  it('reports team enter and leave actions as handled host actions', async () => {
    const enterHarness = createHarness({
      ok: true,
      command: 'team',
      output: 'Entered team builders.',
      action: {type: 'enter_team', teamId: 'team-1'},
    });
    const leaveHarness = createHarness({
      ok: true,
      command: 'team',
      output: 'Left team view.',
      action: {type: 'leave_team'},
    });

    expect(await enterHarness.run()).toBe(true);
    expect(await leaveHarness.run()).toBe(true);
    expect(enterHarness.notices).toEqual([{level: 'system', content: 'Entered team builders.'}]);
    expect(leaveHarness.notices).toEqual([{level: 'system', content: 'Left team view.'}]);
  });
});
