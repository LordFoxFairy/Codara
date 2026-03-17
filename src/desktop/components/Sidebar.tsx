import { useMemo } from "react";
import {
  MessageSquare,
  BarChart3,
  Zap,
  FolderClock,
  Cpu,
  Settings,
  Bug,
  ScrollText,
  FileText,
  Hash,
} from "lucide-react";
import type { Session } from "../types";

/* ── Types ──────────────────────────────────────────────────────── */

type NavPage = "chat" | "sessions" | "skills" | "config" | "debug" | "logs" | "docs";

interface SidebarProps {
  sessions: Session[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  loading: boolean;
  collapsed: boolean;
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
}

/* ── Constants ──────────────────────────────────────────────────── */

const ICON_SIZE = 18;
const ICON_STROKE = 1.75;

/* ── Helpers ────────────────────────────────────────────────────── */

function formatRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

/* ── Sub-components ─────────────────────────────────────────────── */

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between px-3 pt-5 pb-1 first:pt-3">
      <span className="select-none text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
        {label}
      </span>
      <span className="text-[var(--color-text-tertiary)] opacity-40">—</span>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active = false,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "group flex w-full items-center gap-3 rounded-lg px-3 py-[7px] text-left text-[13px] transition-all duration-150",
        active
          ? "bg-[var(--color-accent-light)] font-medium text-[var(--color-accent)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
      ].join(" ")}
    >
      <Icon
        size={ICON_SIZE}
        strokeWidth={ICON_STROKE}
        className={[
          "shrink-0 transition-colors",
          active
            ? "text-[var(--color-accent)]"
            : "text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-secondary)]",
        ].join(" ")}
      />
      <span className="truncate">{label}</span>
    </button>
  );
}

/* ── Collapsed ──────────────────────────────────────────────────── */

function CollapsedSidebar({
  activePage,
  onNavigate,
  sessions,
  currentSessionId,
  onSelectSession,
}: Pick<SidebarProps, "activePage" | "onNavigate" | "sessions" | "currentSessionId" | "onSelectSession">) {
  return (
    <aside className="flex h-full w-[52px] flex-col items-center border-r border-[var(--color-border)] bg-[var(--color-surface-alt)] py-2 transition-all duration-300">
      {/* Chat */}
      <IconBtn
        icon={MessageSquare}
        active={activePage === "chat"}
        onClick={() => onNavigate("chat")}
        title="Chat"
      />

      {/* Session icons when on chat page */}
      {activePage === "chat" && sessions.length > 0 && (
        <>
          <div className="mx-auto my-1.5 w-5 border-t border-[var(--color-border-subtle)]" />
          <div className="flex flex-1 flex-col items-center gap-0.5 overflow-y-auto">
            {sessions.slice(0, 8).map((s) => (
              <IconBtn
                key={s.id}
                icon={Hash}
                active={currentSessionId === s.id}
                onClick={() => onSelectSession(s.id)}
                title={s.title || "New Chat"}
              />
            ))}
          </div>
        </>
      )}

      {/* Bottom nav icons */}
      <div className="mt-auto flex flex-col items-center gap-0.5 pt-2">
        <IconBtn icon={FolderClock} active={activePage === "sessions"} onClick={() => onNavigate("sessions")} title="Sessions" />
        <IconBtn icon={Zap} active={activePage === "skills"} onClick={() => onNavigate("skills")} title="Skills" />
        <IconBtn icon={Settings} active={activePage === "config"} onClick={() => onNavigate("config")} title="Config" />
      </div>
    </aside>
  );
}

function IconBtn({
  icon: Icon,
  active,
  onClick,
  title,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-lg p-2 transition-colors",
        active
          ? "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
          : "text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]",
      ].join(" ")}
      title={title}
    >
      <Icon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
    </button>
  );
}

/* ── Main Sidebar ───────────────────────────────────────────────── */

export function Sidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  loading,
  collapsed,
  activePage,
  onNavigate,
}: SidebarProps) {
  const sortedSessions = useMemo(
    () =>
      [...sessions].sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt).getTime() -
          new Date(a.updatedAt || a.createdAt).getTime(),
      ),
    [sessions],
  );

  if (collapsed) {
    return (
      <CollapsedSidebar
        activePage={activePage}
        onNavigate={onNavigate}
        sessions={sortedSessions}
        currentSessionId={currentSessionId}
        onSelectSession={onSelectSession}
      />
    );
  }

  return (
    <aside className="flex h-full w-[220px] flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-alt)] transition-all duration-300">
      {/* ── Chat ── */}
      <SectionHeader label="Chat" />
      <div className="px-2">
        <NavItem
          icon={MessageSquare}
          label="Chat"
          active={activePage === "chat"}
          onClick={() => onNavigate("chat")}
        />
      </div>

      {/* Session list (only when on Chat page) */}
      {activePage === "chat" && (
        <div className="flex min-h-0 flex-col">
          <div className="max-h-[40vh] overflow-y-auto px-2 pt-1 pb-2">
            {loading ? (
              <div className="space-y-1 px-1 pt-1">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-[42px] animate-pulse rounded-lg bg-[var(--color-surface-hover)]" />
                ))}
              </div>
            ) : sortedSessions.length === 0 ? (
              <div className="px-3 py-6 text-center text-[11px] text-[var(--color-text-tertiary)] opacity-60">
                No conversations yet
              </div>
            ) : (
              <div className="space-y-px">
                {sortedSessions.map((session) => {
                  const isActive = currentSessionId === session.id;
                  return (
                    <button
                      key={session.id}
                      onClick={() => onSelectSession(session.id)}
                      className={[
                        "group flex w-full items-center gap-2.5 rounded-lg px-3 py-[6px] text-left transition-all duration-150",
                        isActive
                          ? "bg-[var(--color-surface-elevated)] font-medium text-[var(--color-text-primary)] shadow-[var(--shadow-xs)]"
                          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]",
                      ].join(" ")}
                    >
                      <Hash
                        size={14}
                        strokeWidth={1.75}
                        className={isActive ? "text-[var(--color-accent)]" : "text-[var(--color-text-tertiary)] opacity-60"}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] leading-snug">
                          {session.title || "New Chat"}
                        </div>
                        <div className="truncate text-[10px] text-[var(--color-text-tertiary)] opacity-60">
                          {session.messageCount > 0 ? `${session.messageCount} msgs` : "Empty"} · {formatRelativeTime(session.updatedAt || session.createdAt)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Spacer pushes bottom sections down */}
      <div className="flex-1" />

      {/* ── Control ── */}
      <SectionHeader label="Control" />
      <div className="px-2">
        <NavItem
          icon={BarChart3}
          label="Overview"
          active={activePage === "debug"}
          onClick={() => onNavigate("debug")}
        />
        <NavItem
          icon={FolderClock}
          label="Sessions"
          active={activePage === "sessions"}
          onClick={() => onNavigate("sessions")}
        />
      </div>

      {/* ── Agent ── */}
      <SectionHeader label="Agent" />
      <div className="px-2">
        <NavItem
          icon={Zap}
          label="Skills"
          active={activePage === "skills"}
          onClick={() => onNavigate("skills")}
        />
        <NavItem
          icon={Cpu}
          label="Nodes"
          active={activePage === "config"}
          onClick={() => onNavigate("config")}
        />
      </div>

      {/* ── Settings ── */}
      <SectionHeader label="Settings" />
      <div className="px-2">
        <NavItem
          icon={Settings}
          label="Config"
          active={activePage === "config"}
          onClick={() => onNavigate("config")}
        />
        <NavItem
          icon={Bug}
          label="Debug"
          active={activePage === "debug"}
          onClick={() => onNavigate("debug")}
        />
        <NavItem
          icon={ScrollText}
          label="Logs"
          active={activePage === "logs"}
          onClick={() => onNavigate("logs")}
        />
      </div>

      {/* ── Resources ── */}
      <SectionHeader label="Resources" />
      <div className="px-2 pb-3">
        <NavItem
          icon={FileText}
          label="Docs"
          active={activePage === "docs"}
          onClick={() => onNavigate("docs")}
        />
      </div>
    </aside>
  );
}

export type { NavPage };
