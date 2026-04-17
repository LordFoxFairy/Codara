import {describe, expect, it} from 'bun:test';
import {mkdtemp, rm, readFile, appendFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {TranscriptWriter, TranscriptReader} from '../../../src/state/session/transcript';
import type {TranscriptEntry} from '../../../src/state/session/types';

function makeEntry(type: TranscriptEntry['type'], content: string): TranscriptEntry {
  return {type, uuid: crypto.randomUUID(), timestamp: Date.now(), content};
}

describe('TranscriptWriter', () => {
  it('should append entries as JSONL', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-transcript-'));
    const filePath = path.join(root, 'test.jsonl');
    try {
      const writer = new TranscriptWriter({filePath, flushInterval: 10});
      await writer.appendImmediate(makeEntry('user', 'Hello'));
      await writer.appendImmediate(makeEntry('assistant', 'Hi there'));
      await writer.close();

      const content = await readFile(filePath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).type).toBe('user');
      expect(JSON.parse(lines[1]).type).toBe('assistant');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should buffer and flush', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-transcript-'));
    const filePath = path.join(root, 'test.jsonl');
    try {
      const writer = new TranscriptWriter({filePath, flushInterval: 50});
      await writer.append(makeEntry('user', 'msg1'));
      await writer.append(makeEntry('user', 'msg2'));
      await writer.flush();
      await writer.close();

      const content = await readFile(filePath, 'utf8');
      expect(content.trim().split('\n')).toHaveLength(2);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});

describe('TranscriptReader', () => {
  it('should read all entries', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-transcript-'));
    const filePath = path.join(root, 'test.jsonl');
    try {
      const writer = new TranscriptWriter({filePath});
      await writer.appendImmediate(makeEntry('user', 'Hello'));
      await writer.appendImmediate(makeEntry('assistant', 'World'));
      await writer.close();

      const reader = new TranscriptReader(filePath);
      const entries = await reader.readAll();
      expect(entries).toHaveLength(2);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should return empty for non-existent file', async () => {
    const reader = new TranscriptReader('/tmp/nonexistent.jsonl');
    const entries = await reader.readAll();
    expect(entries).toEqual([]);
  });

  it('should skip corrupted lines', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-transcript-'));
    const filePath = path.join(root, 'test.jsonl');
    try {
      const writer = new TranscriptWriter({filePath});
      await writer.appendImmediate(makeEntry('user', 'Good'));
      // Manually append a corrupted line
      await appendFile(filePath, '{corrupted json\n', 'utf8');
      await writer.appendImmediate(makeEntry('assistant', 'Also good'));
      await writer.close();

      const reader = new TranscriptReader(filePath);
      const entries = await reader.readAll();
      expect(entries).toHaveLength(2); // Skipped corrupt line
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should read from last compact boundary', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-transcript-'));
    const filePath = path.join(root, 'test.jsonl');
    try {
      const writer = new TranscriptWriter({filePath});
      await writer.appendImmediate(makeEntry('user', 'Old message'));
      await writer.appendImmediate({
        type: 'system', uuid: crypto.randomUUID(), timestamp: Date.now(),
        content: 'Compaction boundary',
        metadata: {subtype: 'compact_boundary'},
      });
      await writer.appendImmediate(makeEntry('user', 'New message'));
      await writer.close();

      const reader = new TranscriptReader(filePath);
      const entries = await reader.readFromLastBoundary();
      expect(entries).toHaveLength(1);
      expect(entries[0].content).toBe('New message');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
