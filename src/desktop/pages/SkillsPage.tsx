import { useCallback, useEffect, useState } from "react";
import { Zap, Wrench, CircleDot, AlertTriangle } from "lucide-react";

import { API_BASE } from "../config";

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpServer {
  name: string;
  status: string;
  tools: McpTool[];
  lastError?: string;
}

export function SkillsPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      if (!res.ok) return;
      const data = await res.json();
      const mcp = (data.mcp ?? []) as McpServer[];
      setServers(mcp);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const totalTools = servers.reduce((sum, s) => sum + (s.tools?.length ?? 0), 0);

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
      <div className="mx-auto max-w-4xl px-6 py-6">
        {/* Stats */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          <StatCard label="MCP Servers" value={servers.length} icon={CircleDot} />
          <StatCard label="Total Tools" value={totalTools} icon={Wrench} />
          <StatCard
            label="Active"
            value={servers.filter((s) => s.status === "connected").length}
            icon={Zap}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-[var(--color-surface-alt)]" />
            ))}
          </div>
        ) : servers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] px-6 py-16 text-center">
            <Zap size={32} strokeWidth={1.5} className="mx-auto mb-3 text-[var(--color-text-tertiary)] opacity-40" />
            <p className="text-[13px] font-medium text-[var(--color-text-secondary)]">No MCP servers connected</p>
            <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
              Configure MCP servers in your .codara/config.json
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {servers.map((server) => (
              <div key={server.name} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
                {/* Server header */}
                <div className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] px-5 py-3">
                  <span className={`h-2 w-2 rounded-full ${
                    server.status === "connected" ? "bg-emerald-500" : "bg-stone-300"
                  }`} />
                  <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                    {server.name}
                  </span>
                  <span className="rounded-full bg-[var(--color-surface-alt)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                    {server.tools?.length ?? 0} tools
                  </span>
                  {server.lastError && (
                    <div className="ml-auto flex items-center gap-1 text-[11px] text-amber-600">
                      <AlertTriangle size={12} />
                      <span className="truncate max-w-[200px]">{server.lastError}</span>
                    </div>
                  )}
                </div>

                {/* Tools list */}
                {server.tools && server.tools.length > 0 && (
                  <div className="divide-y divide-[var(--color-border-subtle)]">
                    {server.tools.map((tool) => (
                      <div key={tool.name} className="flex items-start gap-3 px-5 py-2.5">
                        <Wrench size={13} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[var(--color-text-tertiary)]" />
                        <div className="min-w-0">
                          <span className="text-[12px] font-mono font-medium text-[var(--color-text-primary)]">
                            {tool.name}
                          </span>
                          {tool.description && (
                            <p className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)] line-clamp-2">
                              {tool.description}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
