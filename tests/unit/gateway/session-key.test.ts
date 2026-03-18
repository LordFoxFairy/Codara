import {describe, test, expect} from 'bun:test';
import {buildSessionKey} from '@gateway/session-key';
import type {InboundMessage} from '@gateway/types';

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

describe('buildSessionKey', () => {
  describe('DM scopes', () => {
    test('main scope — single key for all DMs', () => {
      const key = buildSessionKey(makeMsg(), {dmScope: 'main'});
      expect(key).toBe('codara:main');
    });

    test('per-peer scope — key by sender', () => {
      const key = buildSessionKey(makeMsg(), {dmScope: 'per-peer'});
      expect(key).toBe('codara:direct:user1');
    });

    test('per-channel-peer scope — key by channel + sender', () => {
      const key = buildSessionKey(makeMsg(), {dmScope: 'per-channel-peer'});
      expect(key).toBe('codara:telegram:direct:user1');
    });

    test('per-account-channel-peer scope — key by channel + account + sender', () => {
      const key = buildSessionKey(makeMsg(), {dmScope: 'per-account-channel-peer'});
      expect(key).toBe('codara:telegram:bot1:direct:user1');
    });
  });

  describe('group messages', () => {
    test('group always uses group key regardless of DM scope', () => {
      const msg = makeMsg({peer: {kind: 'group', id: 'group1'}});
      const key = buildSessionKey(msg, {dmScope: 'main'});
      expect(key).toBe('codara:telegram:group:group1');
    });

    test('channel peer kind uses group key', () => {
      const msg = makeMsg({peer: {kind: 'channel', id: 'chan1'}});
      const key = buildSessionKey(msg, {dmScope: 'per-peer'});
      expect(key).toBe('codara:telegram:group:chan1');
    });
  });

  describe('identity links', () => {
    test('resolves sender to canonical name via prefixed link', () => {
      const key = buildSessionKey(makeMsg(), {
        dmScope: 'per-peer',
        identityLinks: {alice: ['telegram:user1', 'discord:456']},
      });
      expect(key).toBe('codara:direct:alice');
    });

    test('resolves sender to canonical name via raw senderId', () => {
      const key = buildSessionKey(makeMsg(), {
        dmScope: 'per-peer',
        identityLinks: {alice: ['user1']},
      });
      expect(key).toBe('codara:direct:alice');
    });

    test('no match falls back to raw senderId', () => {
      const key = buildSessionKey(makeMsg(), {
        dmScope: 'per-peer',
        identityLinks: {bob: ['telegram:other']},
      });
      expect(key).toBe('codara:direct:user1');
    });

    test('no links = raw senderId', () => {
      const key = buildSessionKey(makeMsg(), {dmScope: 'per-peer'});
      expect(key).toBe('codara:direct:user1');
    });
  });
});
