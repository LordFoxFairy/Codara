import { useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import type { Message, PauseRequest, RuntimeEvent, StreamStatus } from "../types";
import { MessageBubble } from "./MessageBubble";

interface ChatProps {
  messages: Message[];
  status: StreamStatus;
  pauseRequest: PauseRequest | null;
  runtimeEvent: RuntimeEvent | null;
  onResume: (action: string) => void;
}

export function Chat({ messages, status, pauseRequest, runtimeEvent, onResume }: ChatProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 150;
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  /* ── Empty state ─────────────────────────────────────────── */
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="animate-fade-in text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-accent)] to-violet-500 shadow-lg shadow-violet-500/15">
            <Sparkles size={22} strokeWidth={1.5} className="text-white" />
          </div>
          <h2 className="mb-1 text-lg font-semibold tracking-tight text-[var(--color-text-primary)]">
            Codara
          </h2>
          <p className="text-[13px] text-[var(--color-text-tertiary)]">
            Your AI coding assistant. Ask anything.
          </p>
        </div>
      </div>
    );
  }

  /* ── Message list ────────────────────────────────────────── */
  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="space-y-5">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </div>

        {/* Streaming indicator */}
        {(status === "streaming" || status === "thinking") && (
          <div className="animate-fade-in mt-5 flex items-center gap-3 rounded-xl bg-[var(--color-surface-alt)] px-5 py-3.5 ring-1 ring-[var(--color-border-subtle)]">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-accent)] to-violet-500">
              <Sparkles size={13} strokeWidth={2} className="text-white" />
            </div>
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" style={{ animation: "pulse-dot 1.4s ease-in-out infinite" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" style={{ animation: "pulse-dot 1.4s ease-in-out 0.2s infinite" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" style={{ animation: "pulse-dot 1.4s ease-in-out 0.4s infinite" }} />
              <span className="ml-1 text-[12px] font-medium text-[var(--color-text-tertiary)]">
                {describeRuntimeStatus(status, runtimeEvent)}
              </span>
            </div>
          </div>
        )}

        {/* Pause actions */}
        {status === "paused" && pauseRequest && (
          <div className="animate-fade-in mt-5 rounded-xl border border-amber-200/80 bg-amber-50/60 p-5">
            <p className="mb-3 text-[13px] font-semibold text-amber-800">Action required to continue</p>
            <div className="flex flex-wrap gap-2">
              {pauseRequest.actions.map((action) => (
                <button
                  key={action.value}
                  onClick={() => onResume(action.value)}
                  className="rounded-lg border border-amber-300 bg-white px-3.5 py-1.5 text-[13px] font-medium text-amber-700 shadow-sm transition-all hover:border-amber-400 hover:shadow"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} className="h-2" />
      </div>
    </div>
  );
}

/** Derive a human-readable status label from stream status and the latest runtime event. */
function describeRuntimeStatus(status: StreamStatus, event: RuntimeEvent | null): string {
  if (status === "thinking") return "Thinking...";

  if (!event) return "Writing...";

  switch (event.kind) {
    case "model":
      return "Thinking...";
    case "tool": {
      // Extract tool name from label like "bash(git status)" → "bash"
      const toolMatch = event.label.match(/^(\w+)\(/);
      const toolName = toolMatch?.[1] ?? event.label;
      const truncated = event.label.length > 60 ? `${event.label.slice(0, 57)}...` : event.label;
      return event.phase === "start" ? `Running: ${truncated}` : `Done: ${toolName}`;
    }
    case "task":
      if (event.phase === "start") return "Delegating to subagent...";
      if (event.phase === "end") return "Subagent completed";
      return "Subagent working...";
    case "team":
      if (event.phase === "start") return "Team coordinating...";
      if (event.phase === "update") return event.label.length > 50 ? `${event.label.slice(0, 47)}...` : event.label;
      return "Team completed";
    default:
      return "Working...";
  }
}
