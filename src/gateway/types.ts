import type {ReviewRequest} from '@shared/contracts/agent-types';

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
  /** Whether the bot was explicitly mentioned (@bot) in this message. */
  isMentioned?: boolean;
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

export interface ReviewPromptContext extends OutboundContext {
  review: ReviewRequest;
  actions: ReviewPromptAction[];
}

export interface ReviewPromptAction {
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

/** DM session scoping strategy */
export type DmScope = 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';

/** Cross-channel identity mapping */
export interface IdentityLinks {
  [canonicalName: string]: string[]; // e.g. {alice: ['telegram:123', 'discord:456']}
}

/** Session reset policy */
export interface SessionResetPolicy {
  mode: 'idle' | 'daily' | 'never';
  idleMinutes?: number; // For 'idle' mode (default: 120)
  atHour?: number; // For 'daily' mode, hour in local time (default: 4)
}

/** Extended gateway config with session settings */
export interface GatewaySessionConfig {
  dmScope?: DmScope;
  identityLinks?: IdentityLinks;
  resetPolicy?: SessionResetPolicy;
  resetByType?: {
    direct?: SessionResetPolicy;
    group?: SessionResetPolicy;
  };
  maxSessions?: number;
  persistDir?: string; // Directory for session persistence (default: ~/.codara/gateway/sessions)
}

export interface GatewayConfig {
  gateway?: {host?: string; port?: number; webhookBaseUrl?: string};
  channels: Record<string, ChannelAccountsConfig>;
  bindings?: GatewayBinding[];
  session?: GatewaySessionConfig;
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
