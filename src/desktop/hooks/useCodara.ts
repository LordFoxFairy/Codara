/**
 * @module desktop/hooks/useCodara
 *
 * Core React hook for agent communication.
 * Manages the SSE streaming lifecycle: sending prompts, receiving token/thinking/
 * tool_call events, handling review pauses, and maintaining the message list.
 */

import { useCallback, useRef, useState } from "react";
import type { Message, ReviewRequest, RuntimeEvent, StreamStatus, ToolCall } from "../types";

import { API_BASE } from "../config";

/** Generate a unique message ID for the frontend message list. */
function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

interface UseCodaraOptions {
  sessionId: string | null;
}

type SSEEventType =
  | "token"
  | "thinking"
  | "tool_call"
  | "runtime_event"
  | "done"
  | "error"
  | "review_required";

interface SSEEvent {
  type: SSEEventType;
  data: Record<string, unknown>;
}

/** Parse raw SSE text into structured events. */
function parseSSEChunk(
  buffer: string,
): { events: SSEEvent[]; remaining: string } {
  const events: SSEEvent[] = [];
  // SSE format: lines separated by \n, blocks separated by \n\n
  const blocks = buffer.split("\n\n");
  // The last block may be incomplete
  const remaining = blocks.pop() ?? "";

  for (const block of blocks) {
    if (!block.trim()) continue;

    let eventType: SSEEventType = "token";
    let dataStr = "";

    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim() as SSEEventType;
      } else if (line.startsWith("data:")) {
        dataStr = line.slice(5).trim();
      }
    }

    if (!dataStr) continue;

    try {
      const data = JSON.parse(dataStr) as Record<string, unknown>;
      events.push({ type: eventType, data });
    } catch {
      // Skip malformed data
    }
  }

  return { events, remaining };
}

export function useCodara({ sessionId }: UseCodaraOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [reviewRequest, setReviewRequest] = useState<ReviewRequest | null>(null);
  const [runtimeEvent, setRuntimeEvent] = useState<RuntimeEvent | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isStreaming = status === "streaming" || status === "thinking";

  /** Consume an SSE response stream, dispatching parsed events to state. */
  const streamSSE = useCallback(
    async (response: Response, assistantId: string, controller: AbortController) => {
      abortRef.current = controller;

      try {
        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const { events, remaining } = parseSSEChunk(buffer);
          buffer = remaining;

          for (const event of events) {
            processEvent(event, assistantId, setMessages, setStatus, setError, setReviewRequest, setRuntimeEvent);
          }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
          const { events } = parseSSEChunk(buffer + "\n\n");
          for (const event of events) {
            processEvent(event, assistantId, setMessages, setStatus, setError, setReviewRequest, setRuntimeEvent);
          }
        }

        setStatus((prev) => (prev === "paused" ? "paused" : "idle"));
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setStatus("idle");
          return;
        }
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        setStatus("idle");
      } finally {
        abortRef.current = null;
      }
    },
    [],
  );

  const sendMessage = useCallback(
    async (prompt: string) => {
      if (!sessionId || isStreaming) return;

      setError(null);
      setReviewRequest(null);
      setRuntimeEvent(null);

      const userMessage: Message = {
        id: generateId(),
        role: "user",
        content: prompt,
        timestamp: Date.now(),
      };

      const assistantId = generateId();
      const assistantMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        thinking: "",
        toolCalls: [],
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setStatus("streaming");

      const controller = new AbortController();
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, prompt }),
        signal: controller.signal,
      }).catch((err) => {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
        setStatus("idle");
        return null;
      });

      if (response) {
        await streamSSE(response, assistantId, controller);
      }
    },
    [sessionId, isStreaming, streamSSE],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
  }, []);

  const resumeReview = useCallback(
    async (action: string) => {
      if (!sessionId) return;
      setReviewRequest(null);
      setStatus("streaming");

      const assistantId = generateId();
      const assistantMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        thinking: "",
        toolCalls: [],
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      const controller = new AbortController();
      const response = await fetch(`${API_BASE}/api/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, action }),
        signal: controller.signal,
      }).catch((err) => {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
        setStatus("idle");
        return null;
      });

      if (response) {
        await streamSSE(response, assistantId, controller);
      }
    },
    [sessionId, streamSSE],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setReviewRequest(null);
    setRuntimeEvent(null);
    setStatus("idle");
  }, []);

  const restoreMessages = useCallback((restored: Message[]) => {
    setMessages(restored);
    setError(null);
    setReviewRequest(null);
    setStatus("idle");
  }, []);

  return {
    messages,
    status,
    isStreaming,
    error,
    reviewRequest,
    runtimeEvent,
    sendMessage,
    stopStreaming,
    resumeReview,
    clearMessages,
    restoreMessages,
  };
}

function processEvent(
  event: SSEEvent,
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setStatus: React.Dispatch<React.SetStateAction<StreamStatus>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  setReviewRequest: React.Dispatch<React.SetStateAction<ReviewRequest | null>>,
  setRuntimeEvent: React.Dispatch<React.SetStateAction<RuntimeEvent | null>>,
) {
  switch (event.type) {
    case "token": {
      const text = event.data.text as string;
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? { ...msg, content: msg.content + text }
            : msg,
        ),
      );
      setStatus("streaming");
      break;
    }

    case "thinking": {
      const text = event.data.text as string;
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? { ...msg, thinking: (msg.thinking ?? "") + text }
            : msg,
        ),
      );
      setStatus("thinking");
      break;
    }

    case "tool_call": {
      const toolCall: ToolCall = {
        name: event.data.name as string,
        args: event.data.args as Record<string, unknown>,
      };
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? { ...msg, toolCalls: [...(msg.toolCalls ?? []), toolCall] }
            : msg,
        ),
      );
      break;
    }

    case "runtime_event": {
      const re: RuntimeEvent = {
        kind: event.data.kind as RuntimeEvent["kind"],
        phase: event.data.phase as RuntimeEvent["phase"],
        status: event.data.status as RuntimeEvent["status"],
        label: (event.data.label as string) ?? "",
        detail: event.data.detail as string | undefined,
      };
      setRuntimeEvent(re);
      setStatus("streaming");
      break;
    }

    case "done":
      setRuntimeEvent(null);
      setStatus("idle");
      break;

    case "error":
      setError(event.data.message as string);
      setStatus("idle");
      break;

    case "review_required":
      setStatus("paused");
      setReviewRequest({
        request: event.data.request as Record<string, unknown>,
        actions: event.data.actions as Array<{
          label: string;
          value: string;
        }>,
      });
      break;
  }
}
