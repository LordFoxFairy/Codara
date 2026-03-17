import { useState, useCallback } from 'react';

export interface TeamSummary {
  teamId: string;
  name: string;
  status: string;
  progress: { done: number; total: number };
  memberCount: number;
  tokenUsage: number;
  health: 'healthy' | 'degraded' | 'failing';
  lastActivity: string;
}

export interface TeamDashboardState {
  teams: TeamSummary[];
  activeTeamId?: string;
  viewMode: 'dashboard' | 'observe' | 'participate';
}

export function useTeamDashboard() {
  const [state, setState] = useState<TeamDashboardState>({
    teams: [],
    viewMode: 'dashboard',
  });

  const enterTeam = useCallback((teamId: string) => {
    setState(prev => ({ ...prev, activeTeamId: teamId, viewMode: 'participate' }));
  }, []);

  const leaveTeam = useCallback(() => {
    setState(prev => ({ ...prev, activeTeamId: undefined, viewMode: 'dashboard' }));
  }, []);

  const updateTeam = useCallback((teamId: string, updates: Partial<TeamSummary>) => {
    setState(prev => ({
      ...prev,
      teams: prev.teams.map(t => t.teamId === teamId ? { ...t, ...updates } : t),
    }));
  }, []);

  const addTeam = useCallback((team: TeamSummary) => {
    setState(prev => ({
      ...prev,
      teams: [...prev.teams.filter(t => t.teamId !== team.teamId), team],
    }));
  }, []);

  const removeTeam = useCallback((teamId: string) => {
    setState(prev => ({
      ...prev,
      teams: prev.teams.filter(t => t.teamId !== teamId),
    }));
  }, []);

  return {
    ...state,
    enterTeam,
    leaveTeam,
    updateTeam,
    addTeam,
    removeTeam,
  };
}
