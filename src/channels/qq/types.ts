/** OneBot v11 protocol types for QQ channel adapter. */

export interface OneBotEvent {
  post_type: 'message' | 'notice' | 'request' | 'meta_event';
  time: number;
  self_id: number;
}

export interface OneBotMessageEvent extends OneBotEvent {
  post_type: 'message';
  message_type: 'private' | 'group';
  sub_type: string;
  message_id: number;
  user_id: number;
  group_id?: number;
  message: OneBotMessageSegment[];
  raw_message: string;
  sender: {user_id: number; nickname: string; card?: string};
}

export interface OneBotMessageSegment {
  type: string; // 'text', 'image', 'face', 'at', 'reply', etc.
  data: Record<string, string>;
}

export interface OneBotApiRequest {
  action: string;
  params: Record<string, unknown>;
  echo?: string;
}

export interface OneBotApiResponse {
  status: 'ok' | 'failed';
  retcode: number;
  data: unknown;
  echo?: string;
}

export interface QQAccountConfig {
  wsUrl: string; // WebSocket URL of OneBot server, e.g. "ws://127.0.0.1:3001"
  accessToken?: string; // Optional auth token
  allowUsers?: string[];
  allowGroups?: string[];
  groupPolicy?: {requireMention?: boolean};
  selfId?: string; // Bot's QQ number (auto-detected from events)
}
