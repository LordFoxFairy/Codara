import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users,
  Play,
  Pause,
  Square,
  Clock,
  CheckCircle,
  XCircle,
  ChevronDown,
} from "lucide-react";
import { API_BASE } from "../config";

/* ── Types ──────────────────────────────────────────────────────── */

interface TeamMember {
  agentId: string;
  role: string;
  status: string;
}

interface Job {
  jobId: string;
  title: string;
  status: string;
  assignee?: string;
}

interface JobProgress {
  total: number;
  done: number;
  inProgress: number;
  blocked: number;
}

export interface Team {
  teamId: string;
  name: string;
  goal: string;
  status: string;
  createdAt: string;
  memberCount?: number;
}

/* ── Page ───────────────────────────────────────────────────────── */

export function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadDetail = useCallback(async (teamId: string) => {
    setDetailLoading(true);
    try {
      const [membersRes, jobsRes] = await Promise.all([
        fetch(`${API_BASE}/api/teams/${teamId}/members`),
        fetch(`${API_BASE}/api/teams/${teamId}/jobs`),
      ]);
      if (membersRes.ok) {
        const mj = await membersRes.json();
        setMembers((mj.members ?? []) as TeamMember[]);
      } else {
        setMembers([]);
      }
      if (jobsRes.ok) {
        const jj = await jobsRes.json();
        setJobs((jj.jobs ?? []) as Job[]);
        setJobProgress((jj.progress ?? null) as JobProgress | null);
      } else {
        setJobs([]);
        setJobProgress(null);
      }
    } catch {
      setMembers([]);
      setJobs([]);
      setJobProgress(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/teams`);
      if (!res.ok) return;
      const json = await res.json();
      setTeams((json.teams ?? []) as Team[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + polling every 5s
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleAction = useCallback(
    async (teamId: string, action: "pause" | "resume" | "kill") => {
      try {
        await fetch(`${API_BASE}/api/teams/${teamId}/${action}`, { method: "POST" });
        void refresh();
      } catch {
        // Silently fail — next poll will reflect state
      }
    },
    [refresh],
  );

  /* ── Derived stats ──────────────────────────────────────────── */

  const currentTeam = useMemo(() => selectCurrentTeam(teams), [teams]);
  const currentTeamId = currentTeam?.teamId;
  const savedTeams = useMemo(() => selectRecoverableTeams(teams, currentTeamId), [currentTeamId, teams]);

  useEffect(() => {
    if (!currentTeamId) {
      setMembers([]);
      setJobs([]);
      setJobProgress(null);
      return;
    }
    void loadDetail(currentTeamId);
  }, [currentTeamId, loadDetail]);

  /* ── Helpers ────────────────────────────────────────────────── */

  const formatRelativeTime = (iso: string) => {
    try {
      const diff = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diff / 60_000);
      const hours = Math.floor(diff / 3_600_000);
      const days = Math.floor(diff / 86_400_000);
      if (mins < 1) return "Just now";
      if (mins < 60) return `${mins}m ago`;
      if (hours < 24) return `${hours}h ago`;
      if (days < 7) return `${days}d ago`;
      return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return iso;
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      running: "bg-emerald-50 text-emerald-600",
      paused: "bg-amber-50 text-amber-600",
      completed: "bg-blue-50 text-blue-600",
      failed: "bg-red-50 text-red-600",
    };
    return map[status] ?? "bg-stone-100 text-stone-500";
  };

  const currentWorkerCount = members.length;
  const currentJobCount = jobs.length;
  const doneJobCount = jobProgress?.done ?? jobs.filter((job) => job.status === "done").length;

  /* ── Render ─────────────────────────────────────────────────── */

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
      <div className="mx-auto max-w-4xl px-6 py-6">
        {/* Stats */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          <StatCard label="Workers" value={currentWorkerCount} icon={Users} />
          <StatCard label="Jobs" value={currentJobCount} icon={Play} />
          <StatCard label="Done" value={doneJobCount} icon={CheckCircle} />
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600">
            {error}
          </div>
        )}

        {/* Current team workspace */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-[var(--color-surface-alt)]" />
            ))}
          </div>
        ) : teams.length === 0 ? (
          <div className="py-20 text-center text-[13px] text-[var(--color-text-tertiary)]">
            No current team workspace yet. Staff the leader with <code className="rounded bg-[var(--color-surface-alt)] px-1.5 py-0.5 text-[12px]">spawn_teammate</code> when you need workers.
          </div>
        ) : (
          <div className="space-y-4">
            {currentTeam && (
              <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
                <div className="flex items-start gap-4 px-5 py-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-light)]">
                    <Users size={16} strokeWidth={1.75} className="text-[var(--color-accent)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                        Current Team Workspace: {currentTeam.name}
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadge(currentTeam.status)}`}>
                        {currentTeam.status}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-[var(--color-text-secondary)] opacity-70">
                      {currentTeam.goal}
                    </p>
                    <div className="mt-0.5 flex items-center gap-3 text-[11px] text-[var(--color-text-tertiary)]">
                      <span>{formatRelativeTime(currentTeam.createdAt)}</span>
                    </div>
                  </div>
                </div>

                {(currentTeam.status === "running" || currentTeam.status === "paused") && (
                  <div className="flex gap-2 border-t border-[var(--color-border-subtle)] px-5 py-2">
                    {currentTeam.status === "running" ? (
                      <ActionButton
                        icon={Pause}
                        label="Pause"
                        onClick={() => void handleAction(currentTeam.teamId, "pause")}
                      />
                    ) : (
                      <ActionButton
                        icon={Play}
                        label="Resume"
                        onClick={() => void handleAction(currentTeam.teamId, "resume")}
                      />
                    )}
                    <ActionButton
                      icon={Square}
                      label="Kill"
                      onClick={() => void handleAction(currentTeam.teamId, "kill")}
                      variant="danger"
                    />
                  </div>
                )}

                <div className="border-t border-[var(--color-border-subtle)] px-5 py-3">
                  {detailLoading ? (
                    <div className="h-12 animate-pulse rounded-lg bg-[var(--color-surface-alt)]" />
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
                          Members ({members.length})
                        </div>
                        {members.length === 0 ? (
                          <div className="text-[12px] text-[var(--color-text-tertiary)]">No active members</div>
                        ) : (
                          <div className="space-y-1">
                            {members.map((m) => (
                              <div key={m.agentId} className="flex items-center gap-2 text-[12px]">
                                <span className="font-medium text-[var(--color-text-primary)]">{m.agentId}</span>
                                <span className="text-[var(--color-text-tertiary)]">{m.role}</span>
                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusBadge(m.status)}`}>
                                  {m.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
                          <span>Jobs</span>
                          {jobProgress && (
                            <span className="normal-case tracking-normal">
                              ({jobProgress.done}/{jobProgress.total} done)
                            </span>
                          )}
                        </div>
                        {jobs.length === 0 ? (
                          <div className="text-[12px] text-[var(--color-text-tertiary)]">No jobs</div>
                        ) : (
                          <div className="space-y-1">
                            {jobs.map((j) => (
                              <div key={j.jobId} className="flex items-center gap-2 text-[12px]">
                                <JobStatusIcon status={j.status} />
                                <span className="text-[var(--color-text-primary)]">{j.title}</span>
                                {j.assignee && (
                                  <span className="text-[var(--color-text-tertiary)]">({j.assignee})</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {savedTeams.length > 0 && (
              <details className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-left">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
                      Recovery / history
                    </div>
                    <div className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">
                      {savedTeams.length} saved workspace{savedTeams.length === 1 ? '' : 's'} available for explicit restore or focus switch.
                    </div>
                  </div>
                  <ChevronDown size={16} className="shrink-0 text-[var(--color-text-tertiary)]" />
                </summary>

                <div className="border-t border-[var(--color-border-subtle)] px-5 py-3">
                  <div className="mb-3 text-[12px] text-[var(--color-text-tertiary)]">
                    Keep this section closed for the normal leader-first flow. These entries are for recovery/history only and do not replace the current workspace automatically.
                  </div>
                  <div className="space-y-2">
                    {savedTeams.map((team) => {
                      return (
                        <div
                          key={team.teamId}
                          className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] transition-all"
                        >
                          <div className="flex items-start gap-4 px-5 py-3.5">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-light)]">
                              <Users size={16} strokeWidth={1.75} className="text-[var(--color-accent)]" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                                  {team.name}
                                </span>
                                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadge(team.status)}`}>
                                  {team.status}
                                </span>
                              </div>
                              <p className="mt-0.5 truncate text-[12px] text-[var(--color-text-secondary)] opacity-70">
                                {team.goal}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────── */

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">
        <Icon size={14} strokeWidth={1.75} />
        <span>{label}</span>
      </div>
      <div className="mt-1 text-[22px] font-semibold text-[var(--color-text-primary)]">{value}</div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  variant = "default",
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
}) {
  const colors =
    variant === "danger"
      ? "text-red-500 hover:bg-red-50 hover:text-red-600"
      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]";

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition-colors ${colors}`}
    >
      <Icon size={14} strokeWidth={1.75} />
      <span>{label}</span>
    </button>
  );
}

function JobStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "done":
      return <CheckCircle size={14} strokeWidth={1.75} className="text-emerald-500" />;
    case "in_progress":
      return <Clock size={14} strokeWidth={1.75} className="text-blue-500" />;
    case "blocked":
      return <XCircle size={14} strokeWidth={1.75} className="text-red-500" />;
    default:
      return <Clock size={14} strokeWidth={1.75} className="text-[var(--color-text-tertiary)]" />;
  }
}

export function selectCurrentTeam(teams: readonly Team[]): Team | undefined {
  return teams.find((team) => ['running', 'paused', 'spawning', 'completing'].includes(team.status));
}

export function selectRecoverableTeams(
  teams: readonly Team[],
  currentTeamId?: string,
): Team[] {
  return teams.filter((team) => team.teamId !== currentTeamId);
}
