/** @module desktop/components/StatCard — Reusable metric card for dashboard pages. */

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}

export function StatCard({ label, value, icon: Icon }: StatCardProps) {
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
