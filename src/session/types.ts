export interface TranscriptEntry {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system' | 'attachment';
  uuid: string;
  parentUuid?: string;
  timestamp: number;
  content: unknown;
  metadata?: {
    model?: string;
    tokens?: number;
    toolName?: string;
    subtype?: string;  // e.g., 'compact_boundary'
  };
}

export interface SessionMetadata {
  sessionId: string;
  projectRoot: string;
  createdAt: number;
  model?: string;
  title?: string;
}
