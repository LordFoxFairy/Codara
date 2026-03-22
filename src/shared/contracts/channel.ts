/**
 * Channel abstraction — decouples review/pause interactions from specific transports.
 *
 * A Channel represents a bi-directional communication endpoint (CLI, Desktop, Telegram, etc.)
 * that can display pause requests and collect user responses.
 */

import type {ReviewRequest, ReviewResumePayload} from './agent-types';

/** Supported channel transport types. */
export type ChannelType =
  | 'cli'
  | 'desktop'
  | 'web'
  | 'telegram'
  | 'dingtalk'
  | 'feishu'
  | 'qq'
  | 'wecom';

/** Message payload sent through a channel. */
export interface ChannelMessage {
  type: 'text' | 'event' | 'error';
  content: string;
  metadata?: Record<string, unknown>;
}

/** Runtime event forwarded to a channel (subset of CodaraRuntimeEvent). */
export interface ChannelRuntimeEvent {
  id: string;
  kind: string;
  phase: string;
  status: string;
  label: string;
  detail?: string;
}

/**
 * A Channel handles bi-directional communication for review interactions.
 *
 * Implementations:
 * - CLI: renders Ink components, collects terminal input
 * - Desktop: renders React components, collects UI input
 * - Web/SSE: sends SSE events, receives POST responses
 * - IM (Telegram, DingTalk, Feishu, QQ, WeCom): sends messages, receives webhook callbacks
 */
export interface Channel {
  /** Unique channel instance identifier. */
  readonly id: string;
  /** Transport type. */
  readonly type: ChannelType;

  /** Send a message to the channel endpoint. */
  sendMessage(message: ChannelMessage): Promise<void>;

  /**
   * Display a pause request and wait for the user's response.
   * This is the core review interaction — the channel renders the request
   * and resolves with the user's decision (approve, edit, reject).
   */
  showReviewRequest(request: ReviewRequest): Promise<ReviewResumePayload>;

  /** Optionally forward runtime events for real-time display. */
  emitEvent?(event: ChannelRuntimeEvent): void;

  /** Clean up channel resources. */
  dispose?(): Promise<void>;
}
