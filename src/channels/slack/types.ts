/** Slack Socket Mode and Web API types. */

// ── Socket Mode ─────────────────────────────────────────────────────────

export interface SlackSocketEnvelope {
  envelope_id: string;
  type: 'events_api' | 'interactive' | 'slash_commands' | 'hello' | 'disconnect';
  payload: unknown;
  accepts_response_payload?: boolean;
}

// ── Events API ──────────────────────────────────────────────────────────

export interface SlackEventsApiPayload {
  type: 'event_callback';
  event: SlackEvent;
  team_id: string;
  event_id: string;
  event_time: number;
}

export interface SlackEvent {
  type: string;
  channel?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  subtype?: string;
  bot_id?: string;
}

export interface SlackMessageEvent extends SlackEvent {
  type: 'message';
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
}

// ── Interactive (Block Actions) ─────────────────────────────────────────

export interface SlackInteractivePayload {
  type: 'block_actions';
  actions: SlackAction[];
  user: {id: string; name?: string; username?: string};
  channel: {id: string; name?: string};
  message?: {ts: string; text?: string};
  trigger_id?: string;
}

export interface SlackAction {
  action_id: string;
  block_id: string;
  type: string;
  value?: string;
}

// ── Block Kit ───────────────────────────────────────────────────────────

export interface SlackBlock {
  type: string;
  text?: SlackTextObject;
  elements?: SlackBlockElement[];
  block_id?: string;
}

export interface SlackTextObject {
  type: 'plain_text' | 'mrkdwn';
  text: string;
}

export interface SlackBlockElement {
  type: 'button';
  text: SlackTextObject;
  action_id: string;
  value?: string;
  style?: 'primary' | 'danger';
}

// ── Web API Response ────────────────────────────────────────────────────

export interface SlackApiResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
}

export interface SlackConnectionOpenResponse {
  ok: boolean;
  url?: string;
  error?: string;
}

export interface SlackAuthTestResponse {
  ok: boolean;
  user_id?: string;
  bot_id?: string;
  error?: string;
}

// ── Config ──────────────────────────────────────────────────────────────

export interface SlackAccountConfig {
  botToken: string;
  appToken: string;
  allowUsers?: string[];
  allowChannels?: string[];
}
