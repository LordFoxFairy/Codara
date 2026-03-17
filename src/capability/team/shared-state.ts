export interface SharedStateEntry {
  teamId: string;
  status: string;
  jobsSummary: {total: number; done: number; failed: number};
  result?: string;
  updatedAt: string;
}

export interface SharedState {
  // Write (Team Leader only)
  updateTeamState(teamId: string, entry: Partial<SharedStateEntry>): void;
  removeTeamState(teamId: string): void;

  // Read (any team's MainAgent)
  getTeamState(teamId: string): SharedStateEntry | undefined;
  getAllTeamStates(): Map<string, SharedStateEntry>;

  // Cross-team dependencies
  addDependency(dependentTeamId: string, dependsOnTeamId: string): void;
  getDependencies(teamId: string): string[];
  isDependencySatisfied(teamId: string): boolean;

  // Lifecycle
  clear(): void;
}

export class MemorySharedState implements SharedState {
  private readonly states = new Map<string, SharedStateEntry>();
  private readonly deps = new Map<string, string[]>();

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
      return;
    }

    this.states.set(teamId, {
      teamId,
      status: 'created',
      jobsSummary: {total: 0, done: 0, failed: 0},
      ...entry,
      updatedAt: now,
    });
  }

  removeTeamState(teamId: string): void {
    this.states.delete(teamId);
    this.deps.delete(teamId);
  }

  getTeamState(teamId: string): SharedStateEntry | undefined {
    return this.states.get(teamId);
  }

  getAllTeamStates(): Map<string, SharedStateEntry> {
    return new Map(this.states);
  }

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

    return depIds.every((depId) => this.states.get(depId)?.status === 'completed');
  }

  clear(): void {
    this.states.clear();
    this.deps.clear();
  }
}

export interface SharedStateConfig {
  backend: 'memory';
}

export const DEFAULT_SHARED_STATE_CONFIG: SharedStateConfig = {
  backend: 'memory',
};

export function createSharedState(_config?: SharedStateConfig): SharedState {
  return new MemorySharedState();
}
