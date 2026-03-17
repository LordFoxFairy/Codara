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

export interface RuntimeStatus {
  model?: string;
  tokensUsed?: number;
  connected: boolean;
}
