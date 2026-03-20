import { useState, useCallback } from 'react';
import type {CodaraRuntimeEvent, TeamQueryDetail} from '@/index';

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
  focusedMemberId?: string;
}

export function deriveTeamActivity(
  detail: TeamQueryDetail,
  events: readonly CodaraRuntimeEvent[],
): TeamActivityItem[] {
  const memberNames = new Map(detail.members.map((member) => [member.memberId, member.name]));
  const activity: TeamActivityItem[] = [];

  for (const event of events) {
    if (event.kind !== 'team' || event.phase !== 'update') {
      continue;
    }
    const detailText = event.detail;

    // member idle: detail = "member.idle:<memberId>"
    if (detailText?.startsWith('member.idle:')) {
      const memberId = detailText.slice('member.idle:'.length);
      const name = memberNames.get(memberId) ?? memberId;
      activity.push({ timestamp: event.timestamp, actor: name, action: 'went idle' });
      continue;
    }

    // member joined: label = "<name> joined as <role>"
    if (event.label?.includes(' joined as ')) {
      const actorName = event.label.split(' joined as ')[0]!.trim();
      activity.push({ timestamp: event.timestamp, actor: actorName, action: 'joined' });
      continue;
    }

    // job completed: label = "Job <jobId> completed"
    if (event.label?.startsWith('Job ') && event.label?.endsWith(' completed')) {
      const jobId = event.label.slice(4, -10).trim();
      activity.push({ timestamp: event.timestamp, actor: 'team', action: `completed job ${jobId}` });
      continue;
    }

    // job failed: label = "Job <jobId> failed"
    if (event.label?.startsWith('Job ') && event.label?.endsWith(' failed')) {
      activity.push({ timestamp: event.timestamp, actor: 'team', action: 'job failed' });
      continue;
    }

    if (!detailText?.startsWith('member.activity:')) {
      continue;
    }
    const rest = detailText.slice('member.activity:'.length);
    const separatorIndex = rest.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }
    const memberId = rest.slice(0, separatorIndex);
    const actor = memberNames.get(memberId);
    if (!actor) {
      continue;
    }
    const action = rest.slice(separatorIndex + 1);
    activity.push({
      timestamp: event.timestamp,
      actor,
      action,
    });
  }

  return activity.slice(-50);
}

export function deriveTeamDetailState(
  detail: TeamQueryDetail,
  events: readonly CodaraRuntimeEvent[] = [],
): TeamDetailState {
  const members = withSyntheticLeader(detail.members, detail.status);
  return {
    teamId: detail.teamId,
    teamName: detail.name,
    goal: detail.goal,
    status: detail.status,
    members: members.map((member) => ({
      memberId: member.memberId,
      name: member.name,
      role: member.role,
      status: member.status,
      model: member.model,
      currentJobId: member.currentJobId,
      tokens: 0,
    })),
    jobs: detail.jobs.map((job) => ({
      id: job.id,
      title: job.title,
      status: job.status,
      assignee: job.assignee,
      blockedBy: job.blockedBy,
    })),
    activity: deriveTeamActivity(detail, events),
    tokenUsage: 0,
    estimatedCost: 0,
  };
}

function withSyntheticLeader(
  members: TeamQueryDetail['members'],
  status: TeamQueryDetail['status'],
): TeamQueryDetail['members'] {
  if (members.some((member) => member.role === 'leader')) {
    return members;
  }

  return [
    {
      memberId: 'leader',
      name: 'Main agent',
      role: 'leader',
      status,
    },
    ...members,
  ];
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
