import type {InboundMessage, GatewayConfig, GatewayBinding} from './types';

export interface GatewayRouter {
  buildSessionKey(msg: InboundMessage): string;
  isAllowed(msg: InboundMessage): boolean;
  requiresMention(msg: InboundMessage): boolean;
  resolveProfile(msg: InboundMessage): string | undefined;
}

export function createGatewayRouter(config: GatewayConfig): GatewayRouter {
  const channelConfigs = config.channels;
  const bindings = config.bindings ?? [];

  return {
    buildSessionKey(msg) {
      return `${msg.channel}:${msg.accountId}:${msg.peer.kind}:${msg.peer.id}`;
    },

    isAllowed(msg) {
      const channelConfig = channelConfigs[msg.channel];
      if (!channelConfig?.enabled) return false;
      const accountConfig = channelConfig.accounts[msg.accountId];
      if (!accountConfig) return false;
      const allowUsers = accountConfig.allowUsers as string[] | undefined;
      const allowGroups = accountConfig.allowGroups as string[] | undefined;
      if (msg.peer.kind === 'direct') {
        return !allowUsers || allowUsers.length === 0 || allowUsers.includes(msg.sender.id);
      }
      return !allowGroups || allowGroups.length === 0 || allowGroups.includes(msg.peer.id);
    },

    requiresMention(msg) {
      if (msg.peer.kind === 'direct') return false;
      const channelConfig = channelConfigs[msg.channel];
      const accountConfig = channelConfig?.accounts[msg.accountId];
      const groupPolicy = accountConfig?.groupPolicy as {requireMention?: boolean} | undefined;
      return groupPolicy?.requireMention ?? true;
    },

    resolveProfile(msg) {
      const binding = bindings.find((b) => {
        if (b.channel !== msg.channel) return false;
        if (b.peer && b.peer !== msg.sender.id && b.peer !== msg.peer.id) return false;
        if (b.group && b.group !== msg.peer.id) return false;
        return true;
      });
      return binding?.profile;
    },
  };
}
