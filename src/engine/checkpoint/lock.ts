/**
 * Advisory file lock for session checkpoint writes.
 *
 * Uses exclusive file creation (flag: 'wx') to prevent concurrent writes
 * to the same session from multiple processes.
 */

import {mkdir, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';

function lockFilePath(rootDir: string, sessionId: string): string {
  return path.join(rootDir, `${sessionId}.lock`);
}

/**
 * Acquire an advisory lock for a session.
 * @throws If the session is already locked.
 */
export async function acquireSessionLock(rootDir: string, sessionId: string): Promise<void> {
  await mkdir(rootDir, {recursive: true});
  const lockPath = lockFilePath(rootDir, sessionId);

  try {
    await writeFile(lockPath, `${process.pid}\n${Date.now()}\n`, {flag: 'wx'});
  } catch (error: unknown) {
    if (isFileExists(error)) {
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
