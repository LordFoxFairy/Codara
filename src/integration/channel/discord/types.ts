/** Discord Gateway (WebSocket) and REST API types. */

// ── Gateway Opcodes ─────────────────────────────────────────────────────

export const GatewayOpcode = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

export type GatewayOpcodeValue = (typeof GatewayOpcode)[keyof typeof GatewayOpcode];

// ── Gateway Payloads ────────────────────────────────────────────────────

export interface GatewayPayload {
  op: GatewayOpcodeValue;
  d: unknown;
  s: number | null;
  t: string | null;
}

export interface GatewayHelloData {
  heartbeat_interval: number;
}

export interface GatewayIdentifyData {
  token: string;
  intents: number;
  properties: {os: string; browser: string; device: string};
}

export interface GatewayReadyData {
  session_id: string;
  resume_gateway_url: string;
  user: {id: string; username: string};
}

// ── Gateway Intents ─────────────────────────────────────────────────────

export const GatewayIntents = {
  GUILDS: 1 << 0,
  GUILD_MESSAGES: 1 << 9,
  GUILD_MESSAGE_REACTIONS: 1 << 10,
  DIRECT_MESSAGES: 1 << 12,
  MESSAGE_CONTENT: 1 << 15,
} as const;

// ── Message Types ───────────────────────────────────────────────────────

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  bot?: boolean;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  referenced_message?: DiscordMessage | null;
}

// ── Interaction Types ───────────────────────────────────────────────────

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
} as const;

export const InteractionCallbackType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_UPDATE_MESSAGE: 6,
} as const;

export interface DiscordInteraction {
  id: string;
  type: number;
  token: string;
  data?: {custom_id: string; component_type: number};
  member?: {user: DiscordUser};
  user?: DiscordUser;
  channel_id: string;
  guild_id?: string;
  message?: {id: string};
}

// ── Message Components ──────────────────────────────────────────────────

export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
} as const;

export const ButtonStyle = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
} as const;

export interface DiscordButton {
  type: 2;
  style: number;
  label: string;
  custom_id: string;
}

export interface DiscordActionRow {
  type: 1;
  components: DiscordButton[];
}

// ── Config ──────────────────────────────────────────────────────────────

export interface DiscordAccountConfig {
  botToken: string;
  allowGuilds?: string[];
  allowChannels?: string[];
}
