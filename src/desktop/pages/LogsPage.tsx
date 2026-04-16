/** @module desktop/pages/LogsPage — Periodic status monitor with pause/clear controls. */

import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollText, Pause, Play, Trash2 } from "lucide-react";

import { API_BASE } from "../config";
const POLL_INTERVAL = 3000;

interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
}

const LEVEL_STYLES: Record<string, string> = {
  info: "text-blue-600 bg-blue-50",
  warn: "text-amber-600 bg-amber-50",
  error: "text-red-600 bg-red-50",
  debug: "text-stone-500 bg-stone-50",
};

/** Status monitor — polls the runtime status endpoint periodically. */
export function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  // Poll runtime events by checking status periodically
  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      if (!res.ok) return;
      const data = await res.json();
      // Generate a log entry from status check
      seqRef.current++;
      const entry: LogEntry = {
        id: `log_${seqRef.current}`,
        timestamp: new Date().toISOString(),
        level: data.status === "ready" ? "info" : "warn",
        message: `Runtime status: ${data.status ?? "unknown"} | Session: ${(data.sessionId as string)?.slice(0, 8) ?? "—"}... | Messages: ${(data.metadata as Record<string, unknown>)?.messageCount ?? 0} | MCP: ${(data.mcp as unknown[])?.length ?? 0} servers`,
      };
      setLogs((prev) => [...prev.slice(-200), entry]);
    } catch (err) {
      seqRef.current++;
      setLogs((prev) => [
        ...prev.slice(-200),
        {
          id: `log_${seqRef.current}`,
          timestamp: new Date().toISOString(),
          level: "error",
          message: `Status poll failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    }
  }, []);

  useEffect(() => {
    void poll(); // initial
    if (paused) return;
    const timer = setInterval(() => void poll(), POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [poll, paused]);

  // Auto-scroll
  useEffect(() => {
    if (!paused) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, paused]);

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString("en-US", { hour12: false });
    } catch { return iso; }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--color-surface)]">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-alt)] px-4 py-2">
        <ScrollText size={14} strokeWidth={1.75} className="text-[var(--color-text-tertiary)]" />
        <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
          {logs.length} entries
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setPaused((p) => !p)}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            onClick={() => setLogs([])}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            <Trash2 size={12} />
            Clear
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto font-mono text-[12px]">
        {logs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-tertiary)]">
            Waiting for events...
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {logs.map((log) => (
              <div key={log.id} className="flex items-start gap-3 px-4 py-1.5 hover:bg-[var(--color-surface-alt)]">
                <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">
                  {formatTime(log.timestamp)}
                </span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${LEVEL_STYLES[log.level] ?? LEVEL_STYLES.debug}`}>
                  {log.level}
                </span>
                <span className="min-w-0 text-[var(--color-text-primary)]">{log.message}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
