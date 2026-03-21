/**
 * Advisory file lock for session checkpoint writes.
 *
 * Uses exclusive file creation (flag: 'wx') to prevent concurrent writes
 * to the same session from multiple processes.
 */

import {mkdir, readFile, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {toFilesystemSafeId} from '@durability/storage-key';

/** Default lock time-to-live: 5 minutes. */
export const LOCK_TTL_MS = 300_000;

function lockFilePath(rootDir: string, sessionId: string): string {
  return path.join(rootDir, `${toFilesystemSafeId(sessionId)}.lock`);
}

/**
 * Check whether a lock file is stale (owner process dead or TTL expired).
 *
 * Returns `true` when the lock can safely be reclaimed:
 * - The PID recorded in the file no longer exists, **or**
 * - The timestamp is older than `ttl` milliseconds.
 */
export async function isLockStale(
  lockPath: string,
  ttl: number = LOCK_TTL_MS,
): Promise<boolean> {
  let content: string;
  try {
    content = await readFile(lockPath, 'utf-8');
  } catch {
    // Lock file disappeared between the EEXIST and this read — treat as stale.
    return true;
  }

  const [pidStr, tsStr] = content.trim().split('\n');
  const pid = Number(pidStr);
  const timestamp = Number(tsStr);

  if (Number.isNaN(pid) || Number.isNaN(timestamp)) {
    // Corrupt lock file — treat as stale.
    return true;
  }

  // Check whether the owning process is still alive.
  if (!isProcessAlive(pid)) {
    return true;
  }

  // Check TTL expiry.
  if (Date.now() - timestamp >= ttl) {
    return true;
  }

  return false;
}

/**
 * Acquire an advisory lock for a session.
 * If the existing lock is stale (dead process or expired TTL), it is
 * automatically reclaimed with a single retry.
 * @throws If the session is already locked by a live process.
 */
export async function acquireSessionLock(rootDir: string, sessionId: string): Promise<void> {
  await mkdir(rootDir, {recursive: true});
  const lockPath = lockFilePath(rootDir, sessionId);

  try {
    await writeFile(lockPath, `${process.pid}\n${Date.now()}\n`, {flag: 'wx'});
  } catch (error: unknown) {
    if (isFileExists(error)) {
      // Check whether we can reclaim a stale lock.
      if (await isLockStale(lockPath)) {
        try {
          await unlink(lockPath);
        } catch {
          // Another process may have already cleaned it up — ignore.
        }
        // Retry once.
        try {
          await writeFile(lockPath, `${process.pid}\n${Date.now()}\n`, {flag: 'wx'});
          return;
        } catch (retryError: unknown) {
          if (isFileExists(retryError)) {
            throw new Error(`Session "${sessionId}" is already locked. Another process may be writing to it.`);
          }
          throw retryError;
        }
      }
      throw new Error(`Session "${sessionId}" is already locked. Another process may be writing to it.`);
    }
    throw error;
  }
}

/**
 * Release the advisory lock for a session.
 * Best-effort — does not throw if the lock file is already gone.
 */
export async function releaseSessionLock(rootDir: string, sessionId: string): Promise<void> {
  const lockPath = lockFilePath(rootDir, sessionId);
  try {
    await unlink(lockPath);
  } catch (error: unknown) {
    if (!isFileMissing(error)) {
      throw error;
    }
  }
}

function isFileExists(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'EEXIST';
}

function isFileMissing(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

/**
 * Returns true if a process with the given PID is currently running.
 * `process.kill(pid, 0)` sends no signal — it only checks existence.
 */
function isProcessAlive(pid: number): boolean {
  // PID 0 is special on POSIX (refers to the process group). Treat as dead.
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
