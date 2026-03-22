/**
 * Channel Registry — manages Channel instances and routes review requests.
 *
 * Responsibilities:
 * - Register/unregister Channel instances by id
 * - Route ReviewRequest to the appropriate channel (via request.channel field)
 * - Fall back to default channel when no specific channel is specified
 */

import type {Channel, ChannelType} from '@shared/contracts/channel';
import type {ReviewRequest, ReviewResumePayload} from '@shared/contracts/agent-types';

export class ChannelRegistry {
  private readonly channels = new Map<string, Channel>();
  private defaultChannelId: string | undefined;

  /** Register a channel. The first registered channel becomes the default. */
  register(channel: Channel): void {
    if (this.channels.has(channel.id)) {
      throw new Error(`Channel "${channel.id}" is already registered.`);
    }
    this.channels.set(channel.id, channel);
    if (!this.defaultChannelId) {
      this.defaultChannelId = channel.id;
    }
  }

  /** Unregister a channel by id. */
  unregister(channelId: string): void {
    this.channels.delete(channelId);
    if (this.defaultChannelId === channelId) {
      const next = this.channels.keys().next();
      this.defaultChannelId = next.done ? undefined : next.value;
    }
  }

  /** Set the default channel (used when ReviewRequest.channel is not specified). */
  setDefault(channelId: string): void {
    if (!this.channels.has(channelId)) {
      throw new Error(`Channel "${channelId}" is not registered.`);
    }
    this.defaultChannelId = channelId;
  }

  /** Get a channel by id. */
  get(channelId: string): Channel | undefined {
    return this.channels.get(channelId);
  }

  /** Get the default channel. */
  getDefault(): Channel | undefined {
    return this.defaultChannelId ? this.channels.get(this.defaultChannelId) : undefined;
  }

  /** List all registered channel ids. */
  list(): string[] {
    return [...this.channels.keys()];
  }

  /** List all channels of a specific type. */
  listByType(type: ChannelType): Channel[] {
    return [...this.channels.values()].filter(ch => ch.type === type);
  }

  /**
   * Resolve which channel should handle a review request.
   * Uses request.channel if specified, otherwise falls back to default.
   */
  resolveChannel(request: ReviewRequest): Channel | undefined {
    if (request.channel) {
      return this.channels.get(request.channel);
    }
    return this.getDefault();
  }

  /**
   * Route a review request to the appropriate channel and wait for response.
   * @throws If no channel can handle the request.
   */
  async routeReview(request: ReviewRequest): Promise<ReviewResumePayload> {
    const channel = this.resolveChannel(request);
    if (!channel) {
      throw new Error(
        `No channel available to handle review request "${request.id}"` +
        (request.channel ? ` (requested channel: "${request.channel}")` : ' (no default channel)'),
      );
    }
    return channel.showReviewRequest(request);
  }

  /** Dispose all registered channels. */
  async disposeAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const channel of this.channels.values()) {
      if (channel.dispose) {
        promises.push(channel.dispose());
      }
    }
    await Promise.allSettled(promises);
    this.channels.clear();
    this.defaultChannelId = undefined;
  }
}
