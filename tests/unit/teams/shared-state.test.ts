import {describe, expect, test} from 'bun:test';
import {MemorySharedState, createSharedState} from '@capability/team/shared-state';

// ── MemorySharedState ─────────────────────────────────────────────────

describe('MemorySharedState', () => {
  // ── updateTeamState / getTeamState ────────────────────────────────

  describe('updateTeamState + getTeamState', () => {
    test('round trip: write then read', () => {
      const state = new MemorySharedState();
      state.updateTeamState('t1', {status: 'running', jobsSummary: {total: 3, done: 1, failed: 0}});

      const entry = state.getTeamState('t1');
      expect(entry).toBeDefined();
      expect(entry!.teamId).toBe('t1');
      expect(entry!.status).toBe('running');
      expect(entry!.jobsSummary).toEqual({total: 3, done: 1, failed: 0});
      expect(entry!.updatedAt).toBeTruthy();
    });

    test('returns undefined for unknown team', () => {
      const state = new MemorySharedState();
      expect(state.getTeamState('nope')).toBeUndefined();
    });

    test('partial update merges with existing state', () => {
      const state = new MemorySharedState();
      state.updateTeamState('t1', {status: 'running', jobsSummary: {total: 5, done: 0, failed: 0}});
      state.updateTeamState('t1', {status: 'completed', result: 'all good'});

      const entry = state.getTeamState('t1');
      expect(entry!.status).toBe('completed');
      expect(entry!.result).toBe('all good');
      // jobsSummary preserved from first write
      expect(entry!.jobsSummary).toEqual({total: 5, done: 0, failed: 0});
    });

    test('new entry gets sensible defaults', () => {
      const state = new MemorySharedState();
      state.updateTeamState('t1', {});

      const entry = state.getTeamState('t1');
      expect(entry!.status).toBe('created');
      expect(entry!.jobsSummary).toEqual({total: 0, done: 0, failed: 0});
    });
  });

  // ── getAllTeamStates ──────────────────────────────────────────────

  describe('getAllTeamStates', () => {
    test('returns all entries', () => {
      const state = new MemorySharedState();
      state.updateTeamState('t1', {status: 'running'});
      state.updateTeamState('t2', {status: 'completed'});

      const all = state.getAllTeamStates();
      expect(all.size).toBe(2);
      expect(all.get('t1')!.status).toBe('running');
      expect(all.get('t2')!.status).toBe('completed');
    });

    test('returns a defensive copy', () => {
      const state = new MemorySharedState();
      state.updateTeamState('t1', {status: 'running'});

      const copy = state.getAllTeamStates();
      copy.delete('t1');
      expect(state.getTeamState('t1')).toBeDefined();
    });
  });

  // ── removeTeamState ──────────────────────────────────────────────

  describe('removeTeamState', () => {
    test('deletes state and dependencies', () => {
      const state = new MemorySharedState();
      state.updateTeamState('t1', {status: 'running'});
      state.addDependency('t1', 't0');

      state.removeTeamState('t1');

      expect(state.getTeamState('t1')).toBeUndefined();
      expect(state.getDependencies('t1')).toEqual([]);
    });
  });

  // ── Dependencies ─────────────────────────────────────────────────

  describe('dependencies', () => {
    test('addDependency / getDependencies', () => {
      const state = new MemorySharedState();
      state.addDependency('t2', 't1');
      state.addDependency('t2', 't0');

      expect(state.getDependencies('t2')).toEqual(['t1', 't0']);
    });

    test('duplicate dependency is ignored', () => {
      const state = new MemorySharedState();
      state.addDependency('t2', 't1');
      state.addDependency('t2', 't1');

      expect(state.getDependencies('t2')).toEqual(['t1']);
    });

    test('getDependencies returns empty array for unknown team', () => {
      const state = new MemorySharedState();
      expect(state.getDependencies('unknown')).toEqual([]);
    });

    test('isDependencySatisfied: true when no dependencies', () => {
      const state = new MemorySharedState();
      expect(state.isDependencySatisfied('t1')).toBe(true);
    });

    test('isDependencySatisfied: true when all deps completed', () => {
      const state = new MemorySharedState();
      state.updateTeamState('t0', {status: 'completed'});
      state.updateTeamState('t1', {status: 'completed'});
      state.addDependency('t2', 't0');
      state.addDependency('t2', 't1');

      expect(state.isDependencySatisfied('t2')).toBe(true);
    });

    test('isDependencySatisfied: false when any dep not completed', () => {
      const state = new MemorySharedState();
      state.updateTeamState('t0', {status: 'completed'});
      state.updateTeamState('t1', {status: 'running'});
      state.addDependency('t2', 't0');
      state.addDependency('t2', 't1');

      expect(state.isDependencySatisfied('t2')).toBe(false);
    });

    test('isDependencySatisfied: false when dep state missing', () => {
      const state = new MemorySharedState();
      state.addDependency('t2', 't1');
      // t1 has no state at all
      expect(state.isDependencySatisfied('t2')).toBe(false);
    });
  });

  // ── clear ────────────────────────────────────────────────────────

  describe('clear', () => {
    test('empties everything', () => {
      const state = new MemorySharedState();
      state.updateTeamState('t1', {status: 'running'});
      state.addDependency('t2', 't1');

      state.clear();

      expect(state.getAllTeamStates().size).toBe(0);
      expect(state.getDependencies('t2')).toEqual([]);
    });
  });
});

// ── Factory ───────────────────────────────────────────────────────────

describe('createSharedState', () => {
  test('defaults to MemorySharedState', () => {
    const state = createSharedState();
    expect(state).toBeInstanceOf(MemorySharedState);
  });

  test('memory backend explicitly', () => {
    const state = createSharedState({backend: 'memory'});
    expect(state).toBeInstanceOf(MemorySharedState);
  });
});
