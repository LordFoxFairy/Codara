import {describe, test, expect, beforeEach, afterEach} from 'bun:test';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {acquireSessionLock, releaseSessionLock, isLockStale, LOCK_TTL_MS} from '@state/checkpoint/lock';

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

describe('LOCK_TTL_MS constant', () => {
  test('is 5 minutes', () => {
    expect(LOCK_TTL_MS).toBe(300_000);
  });
});

describe('isLockStale', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'codara-lock-'));
  });

  afterEach(() => {
    rmSync(tmpDir, {recursive: true, force: true});
  });

  test('returns true when lock file does not exist', async () => {
    const result = await isLockStale(path.join(tmpDir, 'nonexistent.lock'));
    expect(result).toBe(true);
  });

  test('returns true when PID is dead', async () => {
    const lockPath = path.join(tmpDir, 'dead.lock');
    // PID 2147483647 is very unlikely to be alive
    writeFileSync(lockPath, `2147483647\n${Date.now()}\n`);
    const result = await isLockStale(lockPath);
    expect(result).toBe(true);
  });

  test('returns true when timestamp is expired', async () => {
    const lockPath = path.join(tmpDir, 'expired.lock');
    const oldTimestamp = Date.now() - LOCK_TTL_MS - 1000;
    writeFileSync(lockPath, `${process.pid}\n${oldTimestamp}\n`);
    const result = await isLockStale(lockPath);
    expect(result).toBe(true);
  });

  test('returns false when PID is alive and timestamp is fresh', async () => {
    const lockPath = path.join(tmpDir, 'fresh.lock');
    writeFileSync(lockPath, `${process.pid}\n${Date.now()}\n`);
    const result = await isLockStale(lockPath);
    expect(result).toBe(false);
  });

  test('returns true when lock file content is corrupt', async () => {
    const lockPath = path.join(tmpDir, 'corrupt.lock');
    writeFileSync(lockPath, 'garbage\n');
    const result = await isLockStale(lockPath);
    expect(result).toBe(true);
  });

  test('returns true when PID is 0 (special POSIX PID)', async () => {
    const lockPath = path.join(tmpDir, 'pid0.lock');
    writeFileSync(lockPath, `0\n${Date.now()}\n`);
    const result = await isLockStale(lockPath);
    expect(result).toBe(true);
  });

  test('respects custom TTL', async () => {
    const lockPath = path.join(tmpDir, 'custom-ttl.lock');
    const recentTimestamp = Date.now() - 500; // 500ms ago
    writeFileSync(lockPath, `${process.pid}\n${recentTimestamp}\n`);

    // With a 1-second TTL, the lock is fresh
    expect(await isLockStale(lockPath, 1000)).toBe(false);

    // With a 100ms TTL, the lock is expired
    expect(await isLockStale(lockPath, 100)).toBe(true);
  });
});

describe('Stale lock reclamation', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'codara-lock-'));
  });

  afterEach(() => {
    rmSync(tmpDir, {recursive: true, force: true});
  });

  test('acquireSessionLock reclaims lock from dead process', async () => {
    // Manually create a stale lock with a dead PID
    const lockPath = path.join(tmpDir, 'session-stale.lock');
    writeFileSync(lockPath, `2147483647\n${Date.now()}\n`);

    // Should succeed by reclaiming the stale lock
    await acquireSessionLock(tmpDir, 'session-stale');
    await releaseSessionLock(tmpDir, 'session-stale');
  });

  test('acquireSessionLock reclaims expired lock', async () => {
    const lockPath = path.join(tmpDir, 'session-expired.lock');
    const oldTimestamp = Date.now() - LOCK_TTL_MS - 1000;
    writeFileSync(lockPath, `${process.pid}\n${oldTimestamp}\n`);

    // Should succeed by reclaiming the expired lock
    await acquireSessionLock(tmpDir, 'session-expired');
    await releaseSessionLock(tmpDir, 'session-expired');
  });

  test('acquireSessionLock rejects active lock from live process', async () => {
    // Acquire a legitimate lock (current process, fresh timestamp)
    await acquireSessionLock(tmpDir, 'session-active');

    // Second acquire should fail
    await expect(acquireSessionLock(tmpDir, 'session-active')).rejects.toThrow(/already locked/i);

    await releaseSessionLock(tmpDir, 'session-active');
  });
});
