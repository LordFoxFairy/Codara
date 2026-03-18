import {describe, test, expect} from 'bun:test';
import {TeamEventEmitter, isTeamEvent} from '@capability/team/coordination/events';
import type {TeamBusEvent} from '@capability/team/coordination/events';

describe('TeamEventEmitter', () => {
  const sampleEvent: TeamBusEvent = {
    type: 'team.created',
    data: {teamId: 't1', name: 'Alpha', goal: 'Build feature X', depth: 0},
  };

  test('emit() broadcasts to all subscribers', () => {
    const emitter = new TeamEventEmitter();
    const received1: TeamBusEvent[] = [];
    const received2: TeamBusEvent[] = [];

    emitter.subscribe((e) => received1.push(e));
    emitter.subscribe((e) => received2.push(e));

    emitter.emit(sampleEvent);

    expect(received1).toEqual([sampleEvent]);
    expect(received2).toEqual([sampleEvent]);
  });

  test('multiple subscribers receive the same event reference', () => {
    const emitter = new TeamEventEmitter();
    const received1: TeamBusEvent[] = [];
    const received2: TeamBusEvent[] = [];

    emitter.subscribe((e) => received1.push(e));
    emitter.subscribe((e) => received2.push(e));

    emitter.emit(sampleEvent);

    expect(received1[0]).toBe(received2[0]);
  });

  test('subscribe() returns an unsubscribe function that works', () => {
    const emitter = new TeamEventEmitter();
    const received: TeamBusEvent[] = [];

    const unsub = emitter.subscribe((e) => received.push(e));
    emitter.emit(sampleEvent);
    expect(received).toHaveLength(1);

    unsub();
    emitter.emit(sampleEvent);
    expect(received).toHaveLength(1); // no new event after unsubscribe
  });

  test('error in one listener does not affect others', () => {
    const emitter = new TeamEventEmitter();
    const received: TeamBusEvent[] = [];

    emitter.subscribe(() => {
      throw new Error('boom');
    });
    emitter.subscribe((e) => received.push(e));

    emitter.emit(sampleEvent);

    expect(received).toEqual([sampleEvent]);
  });

  test('clear() removes all listeners', () => {
    const emitter = new TeamEventEmitter();
    const received: TeamBusEvent[] = [];

    emitter.subscribe((e) => received.push(e));
    emitter.subscribe((e) => received.push(e));

    emitter.clear();
    emitter.emit(sampleEvent);

    expect(received).toHaveLength(0);
  });

  test('no subscribers means emit is a no-op', () => {
    const emitter = new TeamEventEmitter();
    // Should not throw
    emitter.emit(sampleEvent);
  });
});

describe('isTeamEvent', () => {
  test('returns true for team lifecycle events', () => {
    expect(isTeamEvent({type: 'team.created', data: {teamId: 't1', name: 'A', goal: 'B', depth: 0}})).toBe(true);
    expect(isTeamEvent({type: 'team.running', data: {teamId: 't1'}})).toBe(true);
    expect(isTeamEvent({type: 'team.paused', data: {teamId: 't1', reason: 'budget'}})).toBe(true);
    expect(isTeamEvent({type: 'team.completing', data: {teamId: 't1'}})).toBe(true);
    expect(isTeamEvent({type: 'team.completed', data: {teamId: 't1', summary: 'done'}})).toBe(true);
    expect(isTeamEvent({type: 'team.failed', data: {teamId: 't1', error: 'oops'}})).toBe(true);
    expect(isTeamEvent({type: 'team.archived', data: {teamId: 't1'}})).toBe(true);
  });

  test('returns true for member lifecycle events', () => {
    expect(isTeamEvent({type: 'member.joined', data: {teamId: 't1', memberId: 'm1', name: 'A', role: 'worker', mode: 'local'}})).toBe(true);
    expect(isTeamEvent({type: 'member.idle', data: {teamId: 't1', memberId: 'm1'}})).toBe(true);
    expect(isTeamEvent({type: 'member.working', data: {teamId: 't1', memberId: 'm1', jobId: 'j1'}})).toBe(true);
    expect(isTeamEvent({type: 'member.paused', data: {teamId: 't1', memberId: 'm1'}})).toBe(true);
    expect(isTeamEvent({type: 'member.disconnected', data: {teamId: 't1', memberId: 'm1', reason: 'timeout'}})).toBe(true);
    expect(isTeamEvent({type: 'member.failed', data: {teamId: 't1', memberId: 'm1', error: 'crash'}})).toBe(true);
    expect(isTeamEvent({type: 'member.left', data: {teamId: 't1', memberId: 'm1', reason: 'done'}})).toBe(true);
  });

  test('returns true for job lifecycle events', () => {
    expect(isTeamEvent({type: 'job.created', data: {teamId: 't1', jobId: 'j1', title: 'Fix bug', priority: 1}})).toBe(true);
    expect(isTeamEvent({type: 'job.ready', data: {teamId: 't1', jobId: 'j1'}})).toBe(true);
    expect(isTeamEvent({type: 'job.claimed', data: {teamId: 't1', jobId: 'j1', memberId: 'm1'}})).toBe(true);
    expect(isTeamEvent({type: 'job.in_progress', data: {teamId: 't1', jobId: 'j1', memberId: 'm1'}})).toBe(true);
    expect(isTeamEvent({type: 'job.submitted', data: {teamId: 't1', jobId: 'j1', memberId: 'm1'}})).toBe(true);
    expect(isTeamEvent({type: 'job.reviewed', data: {teamId: 't1', jobId: 'j1', approved: true, reviewerId: 'm2'}})).toBe(true);
    expect(isTeamEvent({type: 'job.done', data: {teamId: 't1', jobId: 'j1'}})).toBe(true);
    expect(isTeamEvent({type: 'job.failed', data: {teamId: 't1', jobId: 'j1', error: 'timeout'}})).toBe(true);
  });

  test('returns true for team message and budget events', () => {
    expect(isTeamEvent({type: 'team.message', data: {teamId: 't1', message: {}}})).toBe(true);
    expect(isTeamEvent({type: 'team.budget.warning', data: {teamId: 't1', usedPercent: 80, remaining: 2000}})).toBe(true);
    expect(isTeamEvent({type: 'team.budget.exceeded', data: {teamId: 't1', action: 'pause'}})).toBe(true);
  });

  test('returns false for non-team events', () => {
    expect(isTeamEvent({type: 'token', sessionId: 's1', text: 'hi'})).toBe(false);
    expect(isTeamEvent({type: 'done', sessionId: 's1', requestId: 'r1'})).toBe(false);
    expect(isTeamEvent({type: 'agent.spawned', agentId: 'a1', sessionId: 's1', task: 'x'})).toBe(false);
    expect(isTeamEvent({type: 'a2a.forward', from: 'a', to: 'b', payload: null})).toBe(false);
  });

  test('returns false for non-objects and malformed values', () => {
    expect(isTeamEvent(null)).toBe(false);
    expect(isTeamEvent(undefined)).toBe(false);
    expect(isTeamEvent(42)).toBe(false);
    expect(isTeamEvent('team.created')).toBe(false);
    expect(isTeamEvent({type: 123})).toBe(false);
    expect(isTeamEvent({})).toBe(false);
  });
});
