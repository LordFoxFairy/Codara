/**
 * Discord REST API client.
 *
 * Covers: sendMessage, createInteractionResponse, triggerTyping.
 * Reference: https://discord.com/developers/docs/resources/channel
 */

import type {DiscordActionRow} from './types';

const BASE_URL = 'https://discord.com/api/v10';

export class DiscordApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly statusCode: number,
    public readonly description: string,
  ) {
    super(`Discord API error [${method}] ${statusCode}: ${description}`);
    this.name = 'DiscordApiError';
  }
}

export interface SendMessageOptions {
  components?: DiscordActionRow[];
}

export interface SendMessageResult {
  id: string;
  channel_id: string;
}

export class DiscordApi {
  constructor(private readonly botToken: string) {}

  private async call<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${this.botToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    // 204 No Content (e.g. triggerTyping, some interaction responses)
    if (res.status === 204) {
      return undefined as T;
    }

    const data = await res.json();

    if (!res.ok) {
      const description = typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>).message ?? JSON.stringify(data)
        : String(data);
      throw new DiscordApiError(method, res.status, String(description));
    }

    return data as T;
  }

  /** Send a message to a channel. */
  async sendMessage(
    channelId: string,
    content: string,
    options?: SendMessageOptions,
  ): Promise<SendMessageResult> {
    const body: Record<string, unknown> = {content};
    if (options?.components) {
      body.components = options.components;
    }
    return this.call<SendMessageResult>(
      'sendMessage',
      `/channels/${channelId}/messages`,
      body,
    );
  }

  /**
   * Respond to an interaction (button click).
   *
   * @param interactionId - The interaction's ID
   * @param interactionToken - The interaction's token
   * @param type - Callback type (4=CHANNEL_MESSAGE_WITH_SOURCE, 6=DEFERRED_UPDATE_MESSAGE)
   * @param content - Optional response message content
   */
  async createInteractionResponse(
    interactionId: string,
    interactionToken: string,
    type: number,
    content?: string,
  ): Promise<void> {
    const body: Record<string, unknown> = {type};
    if (content) {
      body.data = {content};
    }
    await this.call<void>(
      'createInteractionResponse',
      `/interactions/${interactionId}/${interactionToken}/callback`,
      body,
    );
  }

  /** Trigger typing indicator in a channel. */
  async triggerTyping(channelId: string): Promise<void> {
    await this.call<void>('triggerTyping', `/channels/${channelId}/typing`);
  }
}
