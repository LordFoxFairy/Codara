/**
 * @module gateway/session-key
 *
 * Builds deterministic session keys from inbound messages.
 * Keys follow the pattern `codara:<scope-specific-path>` and support
 * cross-channel identity linking (e.g., same user on Telegram + Discord).
 */

import type {InboundMessage, DmScope, IdentityLinks} from './types';

export interface SessionKeyOptions {
  dmScope: DmScope;
  identityLinks?: IdentityLinks;
}

/**
 * Build a session key based on the DM scoping strategy.
 *
 * Keys follow the pattern: codara:<scope-specific-path>
 *
 * DM scoping:
 * - main:                    codara:main
 * - per-peer:                codara:direct:<peerId>
 * - per-channel-peer:        codara:<channel>:direct:<peerId>
 * - per-account-channel-peer: codara:<channel>:<account>:direct:<peerId>
 *
 * Group:
 * - Always per-group:        codara:<channel>:group:<groupId>
 */
export function buildSessionKey(msg: InboundMessage, options: SessionKeyOptions): string {
  const peerId = resolveIdentity(msg.channel, msg.sender.id, options.identityLinks);

  if (msg.peer.kind === 'group' || msg.peer.kind === 'channel') {
    return `codara:${msg.channel}:group:${msg.peer.id}`;
  }

  switch (options.dmScope) {
    case 'main':
      return 'codara:main';
    case 'per-peer':
      return `codara:direct:${peerId}`;
    case 'per-channel-peer':
      return `codara:${msg.channel}:direct:${peerId}`;
    case 'per-account-channel-peer':
      return `codara:${msg.channel}:${msg.accountId}:direct:${peerId}`;
  }
}

/**
 * Resolve a sender's identity through identity links.
 * If the sender matches a linked identity, returns the canonical name.
 */
function resolveIdentity(channel: string, senderId: string, links?: IdentityLinks): string {
  if (!links) return senderId;
  const prefixed = `${channel}:${senderId}`;
  for (const [canonical, ids] of Object.entries(links)) {
    if (ids.includes(prefixed) || ids.includes(senderId)) {
      return canonical;
    }
  }
  return senderId;
}
