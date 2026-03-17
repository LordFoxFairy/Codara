import { useState } from "react";
import type { Message, ToolCall } from "../types";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4 px-4`}
    >
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-blue-600/90 text-white"
            : "bg-gray-800/80 text-gray-100"
        }`}
      >
        {/* Thinking block */}
        {!isUser && message.thinking && (
          <ThinkingBlock text={message.thinking} />
        )}

        {/* Main content */}
        {message.content && (
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {message.content}
          </div>
        )}

        {/* Tool calls */}
        {!isUser &&
          message.toolCalls &&
          message.toolCalls.length > 0 &&
          message.toolCalls.map((tc, i) => (
            <ToolCallBlock key={i} toolCall={tc} />
          ))}

        {/* Empty assistant message (still streaming) */}
        {!isUser &&
          !message.content &&
          !message.thinking &&
          (!message.toolCalls || message.toolCalls.length === 0) && (
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-gray-500" />
              <span
                className="h-2 w-2 animate-pulse rounded-full bg-gray-500"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="h-2 w-2 animate-pulse rounded-full bg-gray-500"
                style={{ animationDelay: "300ms" }}
              />
            </div>
          )}
      </div>
    </div>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-gray-500 transition-colors hover:text-gray-400"
      >
        <svg
          className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
        Thinking
      </button>
      {expanded && (
        <div className="mt-1.5 border-l-2 border-gray-700 pl-3 text-xs leading-relaxed text-gray-500 whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}

function ToolCallBlock({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2 rounded-lg border border-gray-700/50 bg-gray-900/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <svg
          className={`h-3 w-3 text-gray-500 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
        <span className="font-mono text-xs text-amber-400/80">
          {toolCall.name}
        </span>
      </button>
      {expanded && (
        <pre className="overflow-x-auto border-t border-gray-700/50 px-3 py-2 font-mono text-xs text-gray-400">
          {JSON.stringify(toolCall.args, null, 2)}
        </pre>
      )}
    </div>
  );
}
