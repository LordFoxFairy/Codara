/** @module desktop/components/ContentHeader — Page title bar with agent label and action buttons. */

import { RotateCcw, Settings } from "lucide-react";

interface ContentHeaderProps {
  title: string;
  subtitle: string;
  agentLabel?: string;
  onRefresh?: () => void;
  onSettings?: () => void;
}

export function ContentHeader({ title, subtitle, agentLabel, onRefresh, onSettings }: ContentHeaderProps) {
  return (
    <div className="flex shrink-0 items-start justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-6 py-4">
      {/* Left: page title */}
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-text-primary)]">
          {title}
        </h1>
        <p className="mt-0.5 text-[13px] text-[var(--color-text-tertiary)]">
          {subtitle}
        </p>
      </div>

      {/* Right: agent selector + actions */}
      <div className="flex items-center gap-1.5 pt-0.5">
        {agentLabel && (
          <span className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 py-1.5 text-[12px] font-mono text-[var(--color-text-secondary)] shadow-[var(--shadow-xs)]">
            {agentLabel}
          </span>
        )}

        <div className="ml-0.5 flex items-center">
          <button
            onClick={onRefresh}
            className="rounded-md p-1.5 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]"
            title="Refresh"
          >
            <RotateCcw size={15} strokeWidth={1.75} />
          </button>
          <button
            onClick={onSettings}
            className="rounded-md p-1.5 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]"
            title="Settings"
          >
            <Settings size={15} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
