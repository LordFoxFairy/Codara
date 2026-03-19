export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  timestamp: number;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface PauseRequest {
  request: Record<string, unknown>;
  actions: Array<{ label: string; value: string }>;
}

export type ConnectionStatus = "connected" | "disconnected" | "error";
export type StreamStatus = "idle" | "streaming" | "thinking" | "paused";

/** Lightweight runtime event received via SSE for UI status display. */
export interface RuntimeEvent {
  kind: "model" | "tool" | "task" | "team" | "turn" | "hil" | "command" | "summary" | "hook";
  phase: "start" | "update" | "end";
  status: "running" | "done" | "paused" | "error";
  label: string;
  detail?: string;
}

export interface RuntimeStatus {
  model?: string;
  tokensUsed?: number;
  connected: boolean;
}
