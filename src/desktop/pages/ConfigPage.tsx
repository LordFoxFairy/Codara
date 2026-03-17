import { useCallback, useEffect, useState } from "react";
import { Settings, Cpu, Globe, Shield } from "lucide-react";

import { API_BASE } from "../config";

interface StatusData {
  sessionId?: string;
  status?: string;
  metadata?: {
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    contextWindow?: { maxTokens?: number; used?: number };
    messageCount?: number;
    [key: string]: unknown;
  };
  mcp?: Array<{ name: string; status: string }>;
}

export function ConfigPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      if (!res.ok) return;
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
        <div className="mx-auto max-w-4xl space-y-3 px-6 py-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-[var(--color-surface-alt)]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
      <div className="mx-auto max-w-4xl px-6 py-6 space-y-5">
        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600">
            {error}
          </div>
        )}

        {/* Runtime */}
        <Section title="Runtime" icon={Cpu}>
          <ConfigRow label="Session ID" value={status?.sessionId ?? "—"} mono />
          <ConfigRow label="Status" value={status?.status ?? "—"} badge={status?.status === "ready" ? "green" : "gray"} />
          <ConfigRow label="Messages" value={String(status?.metadata?.messageCount ?? 0)} />
        </Section>

        {/* Model */}
        <Section title="Model" icon={Globe}>
          <ConfigRow label="Prompt Tokens" value={formatTokens(status?.metadata?.usage?.promptTokens)} />
          <ConfigRow label="Completion Tokens" value={formatTokens(status?.metadata?.usage?.completionTokens)} />
          <ConfigRow label="Total Tokens" value={formatTokens(status?.metadata?.usage?.totalTokens)} />
          <ConfigRow label="Context Window" value={formatTokens(status?.metadata?.contextWindow?.maxTokens)} />
        </Section>

        {/* MCP */}
        <Section title="MCP Servers" icon={Shield}>
          {(status?.mcp ?? []).length === 0 ? (
            <div className="px-5 py-4 text-[12px] text-[var(--color-text-tertiary)]">No MCP servers configured</div>
          ) : (
            (status?.mcp ?? []).map((s) => (
              <ConfigRow key={s.name} label={s.name} value={s.status} badge={s.status === "connected" ? "green" : "gray"} />
            ))
          )}
        </Section>

        {/* Info */}
        <Section title="Settings" icon={Settings}>
          <div className="px-5 py-4 text-[12px] text-[var(--color-text-tertiary)]">
            Edit <code className="rounded bg-[var(--color-surface-alt)] px-1.5 py-0.5 font-mono text-[11px]">.codara/config.json</code> to configure models, providers, and permissions.
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }: {
  title: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-5 py-3">
        <Icon size={15} strokeWidth={1.75} className="text-[var(--color-text-tertiary)]" />
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{title}</span>
      </div>
      <div className="divide-y divide-[var(--color-border-subtle)]">{children}</div>
    </div>
  );
}

function ConfigRow({ label, value, mono, badge }: {
  label: string;
  value: string;
  mono?: boolean;
  badge?: "green" | "gray";
}) {
  return (
    <div className="flex items-center justify-between px-5 py-2.5">
      <span className="text-[12px] text-[var(--color-text-secondary)]">{label}</span>
      {badge ? (
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
          badge === "green" ? "bg-emerald-50 text-emerald-600" : "bg-stone-100 text-stone-500"
        }`}>{value}</span>
      ) : (
        <span className={`text-[12px] text-[var(--color-text-primary)] ${mono ? "font-mono" : ""}`}>
          {value}
        </span>
      )}
    </div>
  );
}

function formatTokens(n?: number): string {
  if (n === undefined || n === null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
