import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, test} from 'bun:test';

import {MessageLog} from '@capability/team/persistence/message-log';
import type {TeamMessage} from '@capability/team/types';

function makeMessage(overrides: Partial<TeamMessage> = {}): TeamMessage {
  return {
    id: `msg_${crypto.randomUUID().slice(0, 8)}`,
    from: 'member-1',
    to: 'broadcast',
    teamId: 'team-1',
    type: 'message',
    content: 'hello',
    timestamp: new Date().toISOString(),
    read: false,
    ...overrides,
  };
}

function makeTmpLog(): string {
  const dir = mkdtempSync(join(tmpdir(), 'msglog-'));
  return join(dir, 'messages.jsonl');
}

describe('MessageLog', () => {
  test('append + readAll round-trip', () => {
    const log = new MessageLog(makeTmpLog());
    const msg = makeMessage();
    log.append(msg);
    const all = log.readAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(msg.id);
    expect(all[0].content).toBe('hello');
  });

  test('readAll on non-existent file returns []', () => {
    const log = new MessageLog('/tmp/nonexistent-path/messages.jsonl');
    expect(log.readAll()).toEqual([]);
  });

  test('readAll on empty file returns []', () => {
    const path = makeTmpLog();
    writeFileSync(path, '');
    const log = new MessageLog(path);
    expect(log.readAll()).toEqual([]);
  });

  test('readRecent(n) returns last n messages', () => {
    const log = new MessageLog(makeTmpLog());
    for (let i = 0; i < 5; i++) {
      log.append(makeMessage({content: `msg-${i}`}));
    }
    const recent = log.readRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].content).toBe('msg-3');
    expect(recent[1].content).toBe('msg-4');
  });

  test('partial last line is discarded (crash safety)', () => {
    const path = makeTmpLog();
    const msg = makeMessage();
    // Write a valid line followed by a partial line
    writeFileSync(path, JSON.stringify(msg) + '\n' + '{"id":"broken');
    const log = new MessageLog(path);
    const all = log.readAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(msg.id);
  });

  test('multiple appends accumulate', () => {
    const log = new MessageLog(makeTmpLog());
    log.append(makeMessage({content: 'a'}));
    log.append(makeMessage({content: 'b'}));
    log.append(makeMessage({content: 'c'}));
    const all = log.readAll();
    expect(all).toHaveLength(3);
    expect(all.map((m) => m.content)).toEqual(['a', 'b', 'c']);
  });
});
