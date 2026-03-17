// src/capability/team/state/shared-state.ts — SharedState interface

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
