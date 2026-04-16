import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SettingsCache} from '@config/cache';

async function createTempEnv() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codara-cache-'));
  const projectRoot = path.join(root, 'project');
  const userHome = path.join(root, 'home');
  await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
  await mkdir(path.join(userHome, '.codara'), {recursive: true});
  return {root, projectRoot, userHome};
}

describe('SettingsCache', () => {
  it('should cache loaded settings', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      await writeFile(path.join(projectRoot, '.codara', 'settings.json'), JSON.stringify({model: 'opus'}));
      const cache = new SettingsCache({projectRoot, userHome, skipEnv: true});
      const first = await cache.get();
      const second = await cache.get();
      expect(first.model).toBe('opus');
      expect(first).toBe(second);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should return fresh settings after invalidation', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      await writeFile(path.join(projectRoot, '.codara', 'settings.json'), JSON.stringify({model: 'opus'}));
      const cache = new SettingsCache({projectRoot, userHome, skipEnv: true});
      const first = await cache.get();
      expect(first.model).toBe('opus');
      await writeFile(path.join(projectRoot, '.codara', 'settings.json'), JSON.stringify({model: 'sonnet'}));
      await cache.invalidate();
      const second = await cache.get();
      expect(second.model).toBe('sonnet');
      expect(first).not.toBe(second);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should notify listeners on invalidation', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      const cache = new SettingsCache({projectRoot, userHome, skipEnv: true});
      let notified = false;
      cache.onChange(() => { notified = true; });
      await cache.invalidate();
      expect(notified).toBe(true);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
