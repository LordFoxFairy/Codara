import { useState, useCallback } from 'react';

export interface TeamMemberInfo {
  memberId: string;
  name: string;
  role: string;
  status: string;
  model?: string;
  tokens: number;
  currentJobId?: string;
}

export interface TeamJobInfo {
  id: string;
  title: string;
  status: string;
  assignee?: string;
  blockedBy: string[];
}

export interface TeamActivityItem {
  timestamp: string;
  actor: string;
  action: string;
}

export interface TeamDetailState {
  teamId: string;
  teamName: string;
  goal: string;
  status: string;
  members: TeamMemberInfo[];
  jobs: TeamJobInfo[];
  activity: TeamActivityItem[];
  tokenUsage: number;
  estimatedCost: number;
}

export function useTeamDetail(teamId: string) {
  const [state, setState] = useState<TeamDetailState>({
    teamId,
    teamName: '',
    goal: '',
    status: 'created',
    members: [],
    jobs: [],
    activity: [],
    tokenUsage: 0,
    estimatedCost: 0,
  });

  const addActivity = useCallback((item: TeamActivityItem) => {
    setState(prev => ({
      ...prev,
      activity: [...prev.activity.slice(-49), item], // Keep last 50
    }));
  }, []);

  const updateMember = useCallback((memberId: string, updates: Partial<TeamMemberInfo>) => {
    setState(prev => ({
      ...prev,
      members: prev.members.map(m => m.memberId === memberId ? { ...m, ...updates } : m),
    }));
  }, []);

  const updateJob = useCallback((jobId: string, updates: Partial<TeamJobInfo>) => {
    setState(prev => ({
      ...prev,
      jobs: prev.jobs.map(j => j.id === jobId ? { ...j, ...updates } : j),
    }));
  }, []);

  return {
    ...state,
    addActivity,
    updateMember,
    updateJob,
    setState,
  };
}
