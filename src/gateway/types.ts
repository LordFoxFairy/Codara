import type {PauseRequest} from '@shared/contracts/agent-types';

export interface InboundMessage {
  channel: string;
  accountId: string;
  messageId: string;
  sender: {id: string; name?: string; username?: string};
  peer: {kind: 'direct' | 'group' | 'channel'; id: string; name?: string};
  text: string;
  mediaUrls?: string[];
  replyToId?: string;
  threadId?: string;
  timestamp: number;
  raw?: unknown;
}

export interface OutboundContext {
  accountId: string;
  to: string;
  text: string;
  replyToId?: string;
  threadId?: string;
}

export interface OutboundMediaContext extends OutboundContext {
  mediaUrl: string;
  mediaType: 'image' | 'file' | 'audio' | 'video';
  caption?: string;
}

export interface PausePromptContext extends OutboundContext {
  pause: PauseRequest;
  actions: PausePromptAction[];
}

export interface PausePromptAction {
  id: string;
  label: string;
  style: 'approve' | 'reject' | 'edit';
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export type StopHandle = {stop(): Promise<void>};

export interface GatewayConfig {
  gateway?: {host?: string; port?: number; webhookBaseUrl?: string};
  channels: Record<string, ChannelAccountsConfig>;
  bindings?: GatewayBinding[];
}

export interface ChannelAccountsConfig {
  enabled?: boolean;
  accounts: Record<string, Record<string, unknown>>;
}

export interface GatewayBinding {
  channel: string;
  peer?: string;
  group?: string;
  profile?: string;
}
