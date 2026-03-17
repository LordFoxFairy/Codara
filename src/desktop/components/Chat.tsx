import { useEffect, useRef } from "react";
import type { Message, PauseRequest, StreamStatus } from "../types";
import { MessageBubble } from "./MessageBubble";

interface ChatProps {
  messages: Message[];
  status: StreamStatus;
  pauseRequest: PauseRequest | null;
  onResume: (action: string) => void;
}

export function Chat({ messages, status, pauseRequest, onResume }: ChatProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or streaming content
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Only auto-scroll if user is near the bottom already
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      150;

    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="mb-3 text-4xl text-gray-700">&#9670;</div>
          <h2 className="mb-1 text-lg font-medium text-gray-400">Codara</h2>
          <p className="text-sm text-gray-600">
            Start a conversation to begin coding
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto py-4">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {/* Streaming indicator */}
      {(status === "streaming" || status === "thinking") && (
        <div className="px-4 py-1">
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
            {status === "thinking" ? "Thinking..." : "Responding..."}
          </span>
        </div>
      )}

      {/* Pause action buttons */}
      {status === "paused" && pauseRequest && (
        <div className="mx-4 mb-4 rounded-xl border border-amber-800/50 bg-amber-900/20 p-4">
          <p className="mb-3 text-sm text-amber-300">
            Action required to continue
          </p>
          <div className="flex flex-wrap gap-2">
            {pauseRequest.actions.map((action) => (
              <button
                key={action.value}
                onClick={() => onResume(action.value)}
                className="rounded-lg border border-amber-700/50 bg-amber-800/30 px-3 py-1.5 text-sm text-amber-200 transition-colors hover:bg-amber-700/40"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
