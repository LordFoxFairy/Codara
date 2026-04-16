import { Menu, RotateCcw, Monitor } from "lucide-react";
import type { ConnectionStatus, RuntimeStatus } from "../types";

interface TopBarProps {
  connectionStatus: ConnectionStatus;
  runtimeStatus: RuntimeStatus;
  onToggleSidebar: () => void;
  onRefresh?: () => void;
  onOpenDebug?: () => void;
}

function HealthBadge({ status }: { status: ConnectionStatus }) {
  const config = {
    connected: {
      dot: "bg-[var(--color-success)]",
      label: "Health OK",
      wrapper: "border-emerald-200 bg-emerald-50 text-emerald-700",
    },
    disconnected: {
      dot: "bg-[var(--color-text-tertiary)] opacity-50",
      label: "Disconnected",
      wrapper: "border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-tertiary)]",
    },
    error: {
      dot: "bg-[var(--color-error)]",
      label: "Error",
      wrapper: "border-red-200 bg-red-50 text-red-600",
    },
  } as const;

  const c = config[status];

  return (
    <div
      className={[
        "flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none",
        c.wrapper,
      ].join(" ")}
    >
      <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${c.dot}`} />
      <span>{c.label}</span>
    </div>
  );
}

export function TopBar({ connectionStatus, onToggleSidebar, onRefresh, onOpenDebug }: TopBarProps) {
  return (
    <header className="flex h-[46px] shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3">
      {/* Left: hamburger + brand */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={onToggleSidebar}
          className="rounded-md p-1.5 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]"
          title="Toggle sidebar"
        >
          <Menu size={18} strokeWidth={1.75} />
        </button>

        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--color-accent)]">
            <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <span className="text-[14px] font-bold tracking-tight text-[var(--color-text-primary)]">
            CODARA
          </span>
        </div>
      </div>

      {/* Right: health + actions */}
      <div className="flex items-center gap-1.5">
        <HealthBadge status={connectionStatus} />

        <button
          onClick={onOpenDebug}
          className="rounded-md p-1.5 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]"
          title="Debug console"
        >
          <Monitor size={15} strokeWidth={1.75} />
        </button>
        <button
          onClick={onRefresh}
          className="rounded-md p-1.5 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]"
          title="Refresh status"
        >
          <RotateCcw size={15} strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}
