/** @module desktop/pages/DebugPage — Command runner and raw runtime state inspector. */

import { useCallback, useEffect, useState } from "react";
import { Activity, Terminal } from "lucide-react";

import { API_BASE } from "../config";

interface DebugInfo {
  sessionId: string;
  status: string;
  metadata: Record<string, unknown>;
  mcp: Array<{ name: string; status: string; tools?: unknown[] }>;
  uptime?: number;
}

export function DebugPage() {
  const [info, setInfo] = useState<DebugInfo | null>(null);
  const [commandOutput, setCommandOutput] = useState<string | null>(null);
  const [commandInput, setCommandInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      if (!res.ok) return;
      const data = await res.json();
      setInfo(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const executeCommand = useCallback(async () => {
    if (!commandInput.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: commandInput.trim() }),
      });
      const data = await res.json();
      setCommandOutput(data.output ?? data.error ?? "No output");
    } catch (err) {
      setCommandOutput(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [commandInput]);

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
      <div className="mx-auto max-w-4xl space-y-5 px-6 py-6">
        {/* Command runner */}
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
          <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-5 py-3">
            <Terminal size={15} strokeWidth={1.75} className="text-[var(--color-text-tertiary)]" />
            <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Command Runner</span>
          </div>
          <div className="p-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void executeCommand(); }}
                placeholder="Type a /command (e.g. /status, /help)"
                className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:outline-none"
              />
              <button
                onClick={() => void executeCommand()}
                className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-[12px] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
              >
                Run
              </button>
            </div>
            {commandOutput !== null && (
              <pre className="mt-3 max-h-[300px] overflow-auto rounded-lg bg-stone-50 p-3 text-[12px] font-mono text-stone-700 ring-1 ring-stone-200">
                {commandOutput}
              </pre>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600">
            {error}
          </div>
        )}

        {/* Runtime state */}
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
          <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-5 py-3">
            <Activity size={15} strokeWidth={1.75} className="text-[var(--color-text-tertiary)]" />
            <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Runtime State</span>
            <button
              onClick={() => void refresh()}
              className="ml-auto text-[11px] text-[var(--color-accent)] hover:underline"
            >
              Refresh
            </button>
          </div>
          {loading ? (
            <div className="p-4">
              <div className="h-32 animate-pulse rounded-lg bg-[var(--color-surface-alt)]" />
            </div>
          ) : info ? (
            <pre className="max-h-[500px] overflow-auto p-4 text-[12px] font-mono text-[var(--color-text-secondary)]">
              {JSON.stringify(info, null, 2)}
            </pre>
          ) : (
            <div className="p-4 text-[12px] text-[var(--color-text-tertiary)]">Failed to load status</div>
          )}
        </div>
      </div>
    </div>
  );
}
