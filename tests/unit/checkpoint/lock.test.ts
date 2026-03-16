import {describe, test, expect, beforeEach, afterEach} from 'bun:test';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {acquireSessionLock, releaseSessionLock} from '@infra/checkpoint/lock';

let tmpDir: string;

describe('Session file lock', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'codara-lock-'));
  });

  afterEach(() => {
    rmSync(tmpDir, {recursive: true, force: true});
  });

  test('acquire and release succeeds', async () => {
    await acquireSessionLock(tmpDir, 'session-1');
    await releaseSessionLock(tmpDir, 'session-1');
  });

  test('second acquire on same session fails', async () => {
    await acquireSessionLock(tmpDir, 'session-1');
    await expect(acquireSessionLock(tmpDir, 'session-1')).rejects.toThrow(/already locked/i);
    await releaseSessionLock(tmpDir, 'session-1');
  });

  test('different sessions can both lock', async () => {
    await acquireSessionLock(tmpDir, 'session-1');
    await acquireSessionLock(tmpDir, 'session-2');
    await releaseSessionLock(tmpDir, 'session-1');
    await releaseSessionLock(tmpDir, 'session-2');
  });

  test('re-acquire after release succeeds', async () => {
    await acquireSessionLock(tmpDir, 'session-1');
    await releaseSessionLock(tmpDir, 'session-1');
    await acquireSessionLock(tmpDir, 'session-1');
    await releaseSessionLock(tmpDir, 'session-1');
  });
});
