import {describe, expect, it} from 'bun:test';
import {access, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {FileSessionStore} from '@state/session/store';
import {toFilesystemSafeId} from '@state/storage-key';
import type {SessionState} from '@state/session/types';

describe('FileSessionStore', () => {
  it('should persist and list sessions with Windows-invalid session ids via a safe storage key', async () => {
    const basePath = await mkdtemp(path.join(tmpdir(), 'codara-session-store-safe-key-'));
    const store = new FileSessionStore({basePath});
    const sessionId = 'main:task/run\\child?*';
    const state: SessionState = {
      sessionId,
      sessionStatus: 'ready',
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-20T00:00:01.000Z',
      metadata: {
        messageCount: 1,
        lastActivity: '2026-03-20T00:00:01.000Z',
      },
    };

    await store.save(sessionId, state);

    const safeMetadataPath = path.join(basePath, toFilesystemSafeId(sessionId), 'metadata.json');
    const rawMetadataPath = path.join(basePath, sessionId, 'metadata.json');

    await expect(access(safeMetadataPath)).resolves.toBeNull();
    await expect(access(rawMetadataPath)).rejects.toHaveProperty('code', 'ENOENT');
    expect(await store.get(sessionId)).toEqual(state);
    expect(await store.list({includeInternal: true})).toEqual([state]);
  });
});
