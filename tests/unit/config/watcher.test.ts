import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SettingsWatcher} from '@config/watcher';

describe('SettingsWatcher', () => {
  it('should detect file changes and invoke callback', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-watcher-'));
    const settingsDir = path.join(root, '.codara');
    await mkdir(settingsDir, {recursive: true});
    const settingsPath = path.join(settingsDir, 'settings.json');
    try {
      await writeFile(settingsPath, JSON.stringify({model: 'opus'}));
      let changeCount = 0;
      const watcher = new SettingsWatcher({
        watchPaths: [settingsPath],
        onChange: (_changedPath: string) => {
          changeCount++;
        },
        stabilityThreshold: 100,
      });
      await watcher.start();
      await writeFile(settingsPath, JSON.stringify({model: 'sonnet'}));
      // Allow time for fs.watch event + debounce stabilityThreshold (100ms)
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(changeCount).toBeGreaterThanOrEqual(1);
      await watcher.stop();
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should ignore internal writes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-watcher-'));
    const settingsDir = path.join(root, '.codara');
    await mkdir(settingsDir, {recursive: true});
    const settingsPath = path.join(settingsDir, 'settings.json');
    try {
      await writeFile(settingsPath, JSON.stringify({model: 'opus'}));
      let changeCount = 0;
      const watcher = new SettingsWatcher({
        watchPaths: [settingsPath],
        onChange: (_changedPath: string) => {
          changeCount++;
        },
        stabilityThreshold: 100,
      });
      await watcher.start();
      watcher.markInternalWrite(settingsPath);
      await writeFile(settingsPath, JSON.stringify({model: 'sonnet'}));
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(changeCount).toBe(0);
      await watcher.stop();
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
