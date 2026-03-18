import { useState } from "react";
import { Bot, ChevronRight, Lightbulb, User, Wrench } from "lucide-react";
import type { Message, ToolCall } from "../types";

interface MessageBubbleProps {
  message: Message;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const time = formatTime(message.timestamp);

  if (isUser) {
    return (
      <div className="animate-fade-in flex w-full items-start justify-end gap-3">
        {/* Content block */}
        <div className="flex max-w-[75%] flex-col items-end">
          <div className="rounded-xl bg-[#fef7ed] px-5 py-3.5 shadow-sm ring-1 ring-amber-100/60">
            <div className="whitespace-pre-wrap break-words text-[14px] leading-[1.75] text-[var(--color-text-primary)]">
              {message.content}
            </div>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 px-1">
            <span className="text-[11px] font-medium text-[var(--color-text-tertiary)]">
              You
            </span>
            <span className="text-[11px] text-[var(--color-text-tertiary)]">
              {time}
            </span>
          </div>
        </div>

        {/* Avatar */}
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-white shadow-sm">
          <User className="h-4 w-4" strokeWidth={2} />
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="animate-fade-in flex w-full items-start gap-3">
      {/* Avatar */}
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-accent)] to-violet-500 text-white shadow-sm">
        <Bot className="h-4 w-4" strokeWidth={2} />
      </div>

      {/* Content block */}
      <div className="flex min-w-0 max-w-[85%] flex-col">
        <div className="rounded-xl bg-[var(--color-surface-alt)] px-5 py-3.5 shadow-sm ring-1 ring-[var(--color-border-subtle)]">
          {/* Thinking */}
          {message.thinking && <ThinkingBlock text={message.thinking} />}

          {/* Content */}
          {message.content && (
            <div className="whitespace-pre-wrap break-words text-[14px] leading-[1.75] text-[var(--color-text-primary)]">
              {message.content}
            </div>
          )}

          {/* Tool calls */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className={`space-y-2 ${message.content ? "mt-3" : ""}`}>
              {message.toolCalls.map((tc, i) => (
                <ToolCallBlock key={i} toolCall={tc} />
              ))}
            </div>
          )}

          {/* Empty streaming placeholder */}
          {!message.content &&
            !message.thinking &&
            (!message.toolCalls || message.toolCalls.length === 0) && (
              <div className="flex items-center gap-1.5 py-0.5">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-tertiary)]"
                  style={{ animation: "pulse-dot 1.4s ease-in-out infinite" }}
                />
                <span
                  className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-tertiary)]"
                  style={{ animation: "pulse-dot 1.4s ease-in-out 0.2s infinite" }}
                />
                <span
                  className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-tertiary)]"
                  style={{ animation: "pulse-dot 1.4s ease-in-out 0.4s infinite" }}
                />
              </div>
            )}
        </div>

        {/* Meta: role + timestamp */}
        <div className="mt-1.5 flex items-center gap-1.5 px-1">
          <span className="text-[11px] font-medium text-[var(--color-text-tertiary)]">
            Assistant
          </span>
          <span className="text-[11px] text-[var(--color-text-tertiary)]">
            {time}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Thinking block ─────────────────────────────────────────────── */

function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`${expanded ? "mb-3" : "mb-2"}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="group flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[12px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)]"
      >
        <ChevronRight
          className={`h-3 w-3 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          strokeWidth={2}
        />
        <Lightbulb className="h-3 w-3 opacity-60" strokeWidth={1.5} />
        Thinking
      </button>
      {expanded && (
        <div className="mt-1.5 ml-1 border-l-2 border-[var(--color-border)] pl-3 text-[12px] leading-relaxed text-[var(--color-text-tertiary)] whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}

/* ── Tool call block ────────────────────────────────────────────── */

function ToolCallBlock({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] transition-all">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
      >
        <ChevronRight
          className={`h-3 w-3 text-[var(--color-text-tertiary)] transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          strokeWidth={2}
        />
        <Wrench
          className="h-3.5 w-3.5 text-[var(--color-accent)] opacity-70"
          strokeWidth={1.5}
        />
        <span className="font-mono text-[12px] font-medium text-[var(--color-text-secondary)]">
          {formatToolLabel(toolCall.name)}
        </span>
        {summarizeToolArgs(toolCall.name, toolCall.args) && (
          <span className="truncate text-[11px] text-[var(--color-text-tertiary)]">
            {summarizeToolArgs(toolCall.name, toolCall.args)}
          </span>
        )}
      </button>
      {expanded && (
        <pre className="overflow-x-auto border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
          {JSON.stringify(toolCall.args, null, 2)}
        </pre>
      )}
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────── */

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  bash: "Bash",
  read_file: "Read",
  read: "Read",
  write_file: "Write",
  write: "Write",
  edit_file: "Edit",
  edit: "Edit",
  glob: "Glob",
  grep: "Grep",
  fetch_url: "Fetch",
  fetch: "Fetch",
  web_search: "Search",
  search: "Search",
  Task: "Task",
  TaskCreate: "TaskCreate",
  TaskUpdate: "TaskUpdate",
  TaskList: "TaskList",
};

function formatToolLabel(name: string): string {
  return TOOL_DISPLAY_NAMES[name] ?? name;
}

function summarizeToolArgs(name: string, args: Record<string, unknown>): string | undefined {
  const str = (key: string) => {
    const v = args[key];
    return typeof v === "string" ? v.trim() : undefined;
  };

  const limit = (s: string | undefined, max = 60) => {
    if (!s) return undefined;
    return s.length > max ? `${s.slice(0, max - 3)}...` : s;
  };

  switch (name) {
    case "bash":
      return limit(str("command") ?? str("description"));
    case "read_file":
    case "read":
    case "write_file":
    case "write":
    case "edit_file":
    case "edit":
      return limit(str("file_path") ?? str("path"));
    case "glob":
    case "grep":
      return limit(str("pattern"));
    case "fetch_url":
    case "fetch":
      return limit(str("url"));
    case "web_search":
    case "search":
      return limit(str("query"));
    default:
      return undefined;
  }
}
