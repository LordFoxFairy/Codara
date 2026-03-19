import {useCallback, useEffect, useMemo, useState} from 'react';
import type {Codara} from '@/index';
import type {ActiveTeam, UseActiveTeamsOutput} from './use-active-teams';

export interface TeamPanelMemberView {
  name: string;
  role: string;
  status: string;
  currentJobId?: string;
  activity?: string;
}

export interface TeamPanelSelectedMember {
  teamId: string;
  name: string;
  role: string;
}

export interface UseTeamPanelStateInput {
  codara: Pick<Codara, 'getTeamDetail'>;
  activeTeams: UseActiveTeamsOutput;
  refreshIntervalMs?: number;
}

export interface UseTeamPanelStateOutput {
  teams: ActiveTeam[];
  teamMembers?: Map<string, TeamPanelMemberView[]>;
  selectedMember?: TeamPanelSelectedMember;
  selectPreviousMember: () => void;
  selectNextMember: () => void;
}

const DEFAULT_REFRESH_INTERVAL_MS = 1000;

interface DerivedTeamPanelState {
  teams: ActiveTeam[];
  teamMembers?: Map<string, TeamPanelMemberView[]>;
  allMembers: TeamPanelSelectedMember[];
}

// 这里做的是“给 UI 用的派生数据”。
// 不要在 shell-app 里一边组装界面，一边顺手改 team 对象。
export function deriveTeamPanelState(input: UseTeamPanelStateInput): DerivedTeamPanelState {
  const {codara, activeTeams} = input;
  const nextTeams: ActiveTeam[] = [];
  const teamMembers = new Map<string, TeamPanelMemberView[]>();
  const allMembers: TeamPanelSelectedMember[] = [];

  for (const team of activeTeams.activeTeams) {
    const nextTeam: ActiveTeam = {...team};
    const detail = codara.getTeamDetail(team.name) ?? codara.getTeamDetail(team.teamId);

    if (detail) {
      if (detail.name) {
        nextTeam.name = detail.name;
      }
      if (detail.goal && !nextTeam.goal) {
        nextTeam.goal = detail.goal;
      }
      nextTeam.memberCount = detail.members.length;

      if (detail.members.length > 0) {
        const members = detail.members.map((member) => ({
          name: member.name,
          role: member.role,
          status: member.status,
          currentJobId: member.currentJobId,
          activity: activeTeams.memberActivities.get(member.memberId),
        }));
        teamMembers.set(team.teamId, members);
        allMembers.push(...members.map((member) => ({
          teamId: team.teamId,
          name: member.name,
          role: member.role,
        })));
      }
    }

    nextTeams.push(nextTeam);
  }

  return {
    teams: nextTeams,
    ...(teamMembers.size > 0 ? {teamMembers} : {}),
    allMembers,
  };
}

export function useTeamPanelState(input: UseTeamPanelStateInput): UseTeamPanelStateOutput {
  const {codara, activeTeams, refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS} = input;
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [selectedMemberIndex, setSelectedMemberIndex] = useState(-1);

  // team 面板的数据有一部分来自 facade 查询，不完全靠 runtime events 推过来。
  // 这里定时刷新一次，保证成员状态和 job 指向不会卡住。
  useEffect(() => {
    if (!activeTeams.hasActiveTeams) {
      return;
    }

    const timer = setInterval(() => {
      setRefreshVersion((current) => current + 1);
    }, refreshIntervalMs);

    return () => clearInterval(timer);
  }, [activeTeams.hasActiveTeams, refreshIntervalMs]);

  const derived = useMemo(
    () => deriveTeamPanelState({codara, activeTeams}),
    [codara, activeTeams.activeTeams, activeTeams.memberActivities, refreshVersion],
  );

  useEffect(() => {
    setSelectedMemberIndex((current) => {
      if (derived.allMembers.length === 0) {
        return -1;
      }
      if (current >= derived.allMembers.length) {
        return derived.allMembers.length - 1;
      }
      return current;
    });
  }, [derived.allMembers.length]);

  const selectPreviousMember = useCallback(() => {
    if (derived.allMembers.length === 0) {
      return;
    }
    setSelectedMemberIndex((current) => (
      current <= 0 ? derived.allMembers.length - 1 : current - 1
    ));
  }, [derived.allMembers.length]);

  const selectNextMember = useCallback(() => {
    if (derived.allMembers.length === 0) {
      return;
    }
    setSelectedMemberIndex((current) => (
      current >= derived.allMembers.length - 1 ? 0 : current + 1
    ));
  }, [derived.allMembers.length]);

  const selectedMember = selectedMemberIndex >= 0 && selectedMemberIndex < derived.allMembers.length
    ? derived.allMembers[selectedMemberIndex]
    : undefined;

  return {
    teams: derived.teams,
    teamMembers: derived.teamMembers,
    selectedMember,
    selectPreviousMember,
    selectNextMember,
  };
}
