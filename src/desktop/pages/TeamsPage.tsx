import { useCallback, useEffect, useState } from "react";
import {
  Users,
  Play,
  Pause,
  Square,
  Clock,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
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

interface Team {
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  const toggleExpand = useCallback(
    async (teamId: string) => {
      if (expandedId === teamId) {
        setExpandedId(null);
        return;
      }
      setExpandedId(teamId);
      setDetailLoading(true);
      try {
        const [membersRes, jobsRes] = await Promise.all([
          fetch(`${API_BASE}/api/teams/${teamId}/members`),
          fetch(`${API_BASE}/api/teams/${teamId}/jobs`),
        ]);
        if (membersRes.ok) {
          const mj = await membersRes.json();
          setMembers((mj.members ?? []) as TeamMember[]);
        }
        if (jobsRes.ok) {
          const jj = await jobsRes.json();
          setJobs((jj.jobs ?? []) as Job[]);
          setJobProgress((jj.progress ?? null) as JobProgress | null);
        }
      } catch {
        // Detail fetch failed — keep expanded but show empty
        setMembers([]);
        setJobs([]);
        setJobProgress(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [expandedId],
  );

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

  const running = teams.filter((t) => t.status === "running").length;
  const completed = teams.filter((t) => t.status === "completed").length;

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

  /* ── Render ─────────────────────────────────────────────────── */

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
      <div className="mx-auto max-w-4xl px-6 py-6">
        {/* Stats */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          <StatCard label="Total Teams" value={teams.length} icon={Users} />
          <StatCard label="Running" value={running} icon={Play} />
          <StatCard label="Completed" value={completed} icon={CheckCircle} />
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600">
            {error}
          </div>
        )}

        {/* Team list */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-[var(--color-surface-alt)]" />
            ))}
          </div>
        ) : teams.length === 0 ? (
          <div className="py-20 text-center text-[13px] text-[var(--color-text-tertiary)]">
            No teams yet. Use <code className="rounded bg-[var(--color-surface-alt)] px-1.5 py-0.5 text-[12px]">create_team</code> tool to start one.
          </div>
        ) : (
          <div className="space-y-2">
            {teams.map((team) => {
              const isExpanded = expandedId === team.teamId;
              const isActionable = team.status === "running" || team.status === "paused";

              return (
                <div
                  key={team.teamId}
                  className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] transition-all"
                >
                  {/* Card header */}
                  <button
                    onClick={() => void toggleExpand(team.teamId)}
                    className="group flex w-full items-start gap-4 px-5 py-3.5 text-left"
                  >
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
                      <div className="mt-0.5 flex items-center gap-3 text-[11px] text-[var(--color-text-tertiary)]">
                        <span>{formatRelativeTime(team.createdAt)}</span>
                      </div>
                    </div>

                    {/* Expand chevron */}
                    <div className="mt-1 shrink-0 text-[var(--color-text-tertiary)]">
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </div>
                  </button>

                  {/* Action buttons */}
                  {isActionable && (
                    <div className="flex gap-2 border-t border-[var(--color-border-subtle)] px-5 py-2">
                      {team.status === "running" ? (
                        <ActionButton
                          icon={Pause}
                          label="Pause"
                          onClick={() => void handleAction(team.teamId, "pause")}
                        />
                      ) : (
                        <ActionButton
                          icon={Play}
                          label="Resume"
                          onClick={() => void handleAction(team.teamId, "resume")}
                        />
                      )}
                      <ActionButton
                        icon={Square}
                        label="Kill"
                        onClick={() => void handleAction(team.teamId, "kill")}
                        variant="danger"
                      />
                    </div>
                  )}

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-[var(--color-border-subtle)] px-5 py-3">
                      {detailLoading ? (
                        <div className="h-12 animate-pulse rounded-lg bg-[var(--color-surface-alt)]" />
                      ) : (
                        <div className="space-y-3">
                          {/* Members */}
                          <div>
                            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
                              Members ({members.length})
                            </div>
                            {members.length === 0 ? (
                              <div className="text-[12px] text-[var(--color-text-tertiary)]">No members</div>
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

                          {/* Jobs */}
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
                  )}
                </div>
              );
            })}
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
