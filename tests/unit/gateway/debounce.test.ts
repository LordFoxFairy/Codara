import {describe, test, expect, afterEach} from 'bun:test';
import {createDebouncedHandler} from '@gateway/debounce';
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

describe('createDebouncedHandler', () => {
  let disposeFn: (() => void) | undefined;

  afterEach(() => {
    disposeFn?.();
    disposeFn = undefined;
  });

  test('single message passes through after delay', async () => {
    const received: InboundMessage[] = [];
    const handler = createDebouncedHandler(async (msg) => { received.push(msg); }, {windowMs: 50});
    disposeFn = handler.dispose;

    handler.add(makeMsg({text: 'hello'}));
    expect(received.length).toBe(0);

    await new Promise((r) => setTimeout(r, 100));
    expect(received.length).toBe(1);
    expect(received[0]!.text).toBe('hello');
  });

  test('rapid messages merged into one', async () => {
    const received: InboundMessage[] = [];
    const handler = createDebouncedHandler(async (msg) => { received.push(msg); }, {windowMs: 100});
    disposeFn = handler.dispose;

    handler.add(makeMsg({text: '帮我', messageId: 'msg1', timestamp: 1000}));
    handler.add(makeMsg({text: '看看这个文件', messageId: 'msg2', timestamp: 1001}));
    handler.add(makeMsg({text: 'src/index.ts', messageId: 'msg3', timestamp: 1002}));

    await new Promise((r) => setTimeout(r, 200));
    expect(received.length).toBe(1);
    expect(received[0]!.text).toBe('帮我\n看看这个文件\nsrc/index.ts');
    // Last message's metadata preserved
    expect(received[0]!.messageId).toBe('msg3');
    expect(received[0]!.timestamp).toBe(1002);
  });

  test('different peers not merged', async () => {
    const received: InboundMessage[] = [];
    const handler = createDebouncedHandler(async (msg) => { received.push(msg); }, {windowMs: 50});
    disposeFn = handler.dispose;

    handler.add(makeMsg({text: 'from alice', sender: {id: 'alice'}, peer: {kind: 'direct', id: 'alice'}}));
    handler.add(makeMsg({text: 'from bob', sender: {id: 'bob'}, peer: {kind: 'direct', id: 'bob'}}));

    await new Promise((r) => setTimeout(r, 150));
    expect(received.length).toBe(2);
    expect(received.map((m) => m.text).sort()).toEqual(['from alice', 'from bob']);
  });

  test('maxBuffer triggers immediate flush', async () => {
    const received: InboundMessage[] = [];
    const handler = createDebouncedHandler(async (msg) => { received.push(msg); }, {windowMs: 5000, maxBuffer: 3});
    disposeFn = handler.dispose;

    handler.add(makeMsg({text: 'one'}));
    handler.add(makeMsg({text: 'two'}));
    handler.add(makeMsg({text: 'three'}));

    // Should flush immediately without waiting for the 5s window
    await new Promise((r) => setTimeout(r, 50));
    expect(received.length).toBe(1);
    expect(received[0]!.text).toBe('one\ntwo\nthree');
  });

  test('dispose clears all timers', async () => {
    const received: InboundMessage[] = [];
    const handler = createDebouncedHandler(async (msg) => { received.push(msg); }, {windowMs: 50});

    handler.add(makeMsg({text: 'should not arrive'}));
    handler.dispose();

    await new Promise((r) => setTimeout(r, 100));
    expect(received.length).toBe(0);
  });

  test('flush forces all pending buffers', async () => {
    const received: InboundMessage[] = [];
    const handler = createDebouncedHandler(async (msg) => { received.push(msg); }, {windowMs: 5000});
    disposeFn = handler.dispose;

    handler.add(makeMsg({text: 'buffered'}));
    expect(received.length).toBe(0);

    await handler.flush();
    expect(received.length).toBe(1);
    expect(received[0]!.text).toBe('buffered');
  });
});
