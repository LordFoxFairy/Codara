// src/capability/team/state/memory-shared-state.ts — In-memory SharedState backend

import type {SharedState, SharedStateEntry} from './shared-state.js';

export class MemorySharedState implements SharedState {
  private readonly states = new Map<string, SharedStateEntry>();
  private readonly deps = new Map<string, string[]>();

  // ── Write ───────────────────────────────────────────────────────────

  updateTeamState(teamId: string, entry: Partial<SharedStateEntry>): void {
    const existing = this.states.get(teamId);
    const now = new Date().toISOString();

    if (existing) {
      this.states.set(teamId, {
        ...existing,
        ...entry,
        teamId,
        updatedAt: now,
      });
    } else {
      this.states.set(teamId, {
        teamId,
        status: 'created',
        jobsSummary: {total: 0, done: 0, failed: 0},
        ...entry,
        updatedAt: now,
      });
    }
  }

  removeTeamState(teamId: string): void {
    this.states.delete(teamId);
    this.deps.delete(teamId);
  }

  // ── Read ────────────────────────────────────────────────────────────

  getTeamState(teamId: string): SharedStateEntry | undefined {
    return this.states.get(teamId);
  }

  getAllTeamStates(): Map<string, SharedStateEntry> {
    return new Map(this.states);
  }

  // ── Dependencies ────────────────────────────────────────────────────

  addDependency(dependentTeamId: string, dependsOnTeamId: string): void {
    const existing = this.deps.get(dependentTeamId) ?? [];
    if (!existing.includes(dependsOnTeamId)) {
      this.deps.set(dependentTeamId, [...existing, dependsOnTeamId]);
    }
  }

  getDependencies(teamId: string): string[] {
    return this.deps.get(teamId) ?? [];
  }

  isDependencySatisfied(teamId: string): boolean {
    const depIds = this.deps.get(teamId);
    if (!depIds || depIds.length === 0) return true;

    return depIds.every((depId) => {
      const state = this.states.get(depId);
      return state?.status === 'completed';
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  clear(): void {
    this.states.clear();
    this.deps.clear();
  }
}
