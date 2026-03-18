/**
 * Slack Web API client.
 *
 * Covers: chat.postMessage, auth.test, apps.connections.open.
 * Reference: https://api.slack.com/methods
 */

import type {SlackApiResponse, SlackAuthTestResponse, SlackBlock} from './types';

const BASE_URL = 'https://slack.com/api';

export class SlackApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly errorCode: string,
  ) {
    super(`Slack API error [${method}]: ${errorCode}`);
    this.name = 'SlackApiError';
  }
}

export interface PostMessageOptions {
  thread_ts?: string;
  blocks?: SlackBlock[];
}

export class SlackApi {
  constructor(private readonly botToken: string) {}

  private async call<T extends {ok: boolean; error?: string}>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const url = `${BASE_URL}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as T;
    if (!data.ok) {
      throw new SlackApiError(method, data.error ?? 'unknown_error');
    }
    return data;
  }

  /** Send a message to a channel or thread. */
  async postMessage(
    channel: string,
    text: string,
    options?: PostMessageOptions,
  ): Promise<SlackApiResponse> {
    const body: Record<string, unknown> = {channel, text};
    if (options?.thread_ts) {
      body.thread_ts = options.thread_ts;
    }
    if (options?.blocks) {
      body.blocks = options.blocks;
    }
    return this.call<SlackApiResponse>('chat.postMessage', body);
  }

  /** Test authentication and get bot user info. */
  async authTest(): Promise<SlackAuthTestResponse> {
    return this.call<SlackAuthTestResponse>('auth.test', {});
  }
}
