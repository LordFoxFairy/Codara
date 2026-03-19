import {describe, test, expect} from 'bun:test';
import {createGatewayRouter} from '@gateway/router';
import type {InboundMessage, GatewayConfig} from '@gateway/types';

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel: 'telegram',
    accountId: 'bot1',
    messageId: 'msg1',
    sender: {id: 'user1', name: 'Alice'},
    peer: {kind: 'direct', id: 'user1'},
    text: 'hello',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    channels: {
      telegram: {
        enabled: true,
        accounts: {
          bot1: {},
        },
      },
    },
    ...overrides,
  };
}

describe('GatewayRouter', () => {
  describe('isAllowed', () => {
    test('rejects disabled channel', () => {
      const config = makeConfig({
        channels: {telegram: {enabled: false, accounts: {bot1: {}}}},
      });
      const router = createGatewayRouter(config);
      expect(router.isAllowed(makeMsg())).toBe(false);
    });

    test('rejects unknown account', () => {
      const router = createGatewayRouter(makeConfig());
      expect(router.isAllowed(makeMsg({accountId: 'unknown'}))).toBe(false);
    });

    test('allows direct message with no allowUsers', () => {
      const router = createGatewayRouter(makeConfig());
      expect(router.isAllowed(makeMsg())).toBe(true);
    });

    test('allows direct message when sender is in allowUsers', () => {
      const config = makeConfig({
        channels: {
          telegram: {enabled: true, accounts: {bot1: {allowUsers: ['user1']}}},
        },
      });
      const router = createGatewayRouter(config);
      expect(router.isAllowed(makeMsg())).toBe(true);
    });

    test('rejects direct message when sender not in allowUsers', () => {
      const config = makeConfig({
        channels: {
          telegram: {enabled: true, accounts: {bot1: {allowUsers: ['user99']}}},
        },
      });
      const router = createGatewayRouter(config);
      expect(router.isAllowed(makeMsg())).toBe(false);
    });

    test('allows group message with no allowGroups', () => {
      const router = createGatewayRouter(makeConfig());
      expect(
        router.isAllowed(makeMsg({peer: {kind: 'group', id: 'group1'}})),
      ).toBe(true);
    });

    test('rejects group message when group not in allowGroups', () => {
      const config = makeConfig({
        channels: {
          telegram: {enabled: true, accounts: {bot1: {allowGroups: ['group99']}}},
        },
      });
      const router = createGatewayRouter(config);
      expect(
        router.isAllowed(makeMsg({peer: {kind: 'group', id: 'group1'}})),
      ).toBe(false);
    });
  });

  describe('requiresMention', () => {
    test('returns false for direct messages', () => {
      const router = createGatewayRouter(makeConfig());
      expect(router.requiresMention(makeMsg())).toBe(false);
    });

    test('defaults to true for group messages', () => {
      const router = createGatewayRouter(makeConfig());
      expect(
        router.requiresMention(makeMsg({peer: {kind: 'group', id: 'group1'}})),
      ).toBe(true);
    });

    test('respects groupPolicy.requireMention = false', () => {
      const config = makeConfig({
        channels: {
          telegram: {
            enabled: true,
            accounts: {bot1: {groupPolicy: {requireMention: false}}},
          },
        },
      });
      const router = createGatewayRouter(config);
      expect(
        router.requiresMention(makeMsg({peer: {kind: 'group', id: 'group1'}})),
      ).toBe(false);
    });
  });

  describe('resolveProfile', () => {
    test('returns undefined when no bindings match', () => {
      const router = createGatewayRouter(makeConfig());
      expect(router.resolveProfile(makeMsg())).toBeUndefined();
    });

    test('matches binding by channel', () => {
      const config = makeConfig({
        bindings: [{channel: 'telegram', profile: 'assistant'}],
      });
      const router = createGatewayRouter(config);
      expect(router.resolveProfile(makeMsg())).toBe('assistant');
    });

    test('matches binding by channel + peer', () => {
      const config = makeConfig({
        bindings: [
          {channel: 'telegram', peer: 'user1', profile: 'vip'},
          {channel: 'telegram', profile: 'default'},
        ],
      });
      const router = createGatewayRouter(config);
      expect(router.resolveProfile(makeMsg())).toBe('vip');
    });

    test('matches binding by channel + group', () => {
      const config = makeConfig({
        bindings: [{channel: 'telegram', group: 'group1', profile: 'team'}],
      });
      const router = createGatewayRouter(config);
      expect(
        router.resolveProfile(makeMsg({peer: {kind: 'group', id: 'group1'}})),
      ).toBe('team');
    });

    test('skips non-matching binding', () => {
      const config = makeConfig({
        bindings: [{channel: 'slack', profile: 'slack-bot'}],
      });
      const router = createGatewayRouter(config);
      expect(router.resolveProfile(makeMsg())).toBeUndefined();
    });
  });
});
