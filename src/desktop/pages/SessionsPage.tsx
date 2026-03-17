import { useCallback, useEffect, useState } from "react";
import { FolderClock, Hash, Trash2, MessageSquare } from "lucide-react";
import type { Session } from "../types";

const API_BASE = "http://localhost:23981";

interface SessionDetail extends Session {
  status: string;
  lastMessage?: string;
}

export function SessionsPage({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [sessions, setSessions] = useState<SessionDetail[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`);
      if (!res.ok) return;
      const json = await res.json();
      const raw = (json.sessions ?? []) as Record<string, unknown>[];
      const data: SessionDetail[] = raw.map((s) => {
        const meta = (s.metadata ?? {}) as Record<string, unknown>;
        return {
          id: (s.sessionId ?? s.id ?? "") as string,
          title: (meta.title ?? "Untitled") as string,
          createdAt: (s.createdAt ?? "") as string,
          updatedAt: (s.updatedAt ?? s.createdAt ?? "") as string,
          messageCount: (meta.messageCount ?? 0) as number,
          status: (s.sessionStatus ?? "unknown") as string,
          lastMessage: (meta.lastMessage ?? undefined) as string | undefined,
        };
      });
      setSessions(data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
    } catch { return iso; }
  };

  const sessionsWithMessages = sessions.filter((s) => s.messageCount > 0);
  const emptySessions = sessions.filter((s) => s.messageCount === 0);

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
      <div className="mx-auto max-w-4xl px-6 py-6">
        {/* Stats */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          <StatCard label="Total Sessions" value={sessions.length} icon={FolderClock} />
          <StatCard label="With Messages" value={sessionsWithMessages.length} icon={MessageSquare} />
          <StatCard label="Empty" value={emptySessions.length} icon={Hash} />
        </div>

        {/* Session list */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-[var(--color-surface-alt)]" />
            ))}
          </div>
        ) : sessionsWithMessages.length === 0 ? (
          <div className="py-20 text-center text-[13px] text-[var(--color-text-tertiary)]">
            No sessions with messages yet.
          </div>
        ) : (
          <div className="space-y-2">
            {sessionsWithMessages.map((s) => (
              <button
                key={s.id}
                onClick={() => onOpenSession(s.id)}
                className="group flex w-full items-start gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] px-5 py-3.5 text-left transition-all hover:border-[var(--color-border-focus)] hover:shadow-sm"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-light)]">
                  <Hash size={16} strokeWidth={1.75} className="text-[var(--color-accent)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                      {s.title}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      s.status === "ready" ? "bg-emerald-50 text-emerald-600" : "bg-stone-100 text-stone-500"
                    }`}>
                      {s.status}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-[11px] text-[var(--color-text-tertiary)]">
                    <span>{s.messageCount} messages</span>
                    <span>·</span>
                    <span>{formatDate(s.updatedAt)}</span>
                  </div>
                  {s.lastMessage && (
                    <p className="mt-1 truncate text-[12px] text-[var(--color-text-secondary)] opacity-70">
                      {s.lastMessage}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }> }) {
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
