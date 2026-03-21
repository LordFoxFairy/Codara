import {describe, expect, it} from 'bun:test';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  loadScopedCodaraSettings,
  readCodaraSettings,
  resolveAutoMemoryGlobal,
  resolvePluginInstallGlobal,
} from '@/config';

describe('codara settings', () => {
  it('reads plugin and memory settings from settings.json', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-settings-'));
    const settingsPath = path.join(root, 'settings.json');

    try {
      await writeFile(settingsPath, JSON.stringify({
        plugins: {
          installGlobal: false,
        },
        memory: {
          autoGlobal: true,
        },
      }, null, 2));

      expect(readCodaraSettings(settingsPath)).toEqual({
        plugins: {
          installGlobal: false,
        },
        memory: {
          autoGlobal: true,
        },
      });
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('prefers project plugin settings over user settings', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-settings-plugin-scope-'));
    const projectRoot = path.join(root, 'project');
    const userHome = path.join(root, 'home');

    try {
      await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
      await mkdir(path.join(userHome, '.codara'), {recursive: true});

      await writeFile(path.join(projectRoot, '.codara', 'settings.json'), JSON.stringify({
        plugins: {installGlobal: false},
      }, null, 2));
      await writeFile(path.join(userHome, '.codara', 'settings.json'), JSON.stringify({
        plugins: {installGlobal: true},
      }, null, 2));

      expect(resolvePluginInstallGlobal({projectRoot, userHome})).toBe(false);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('prefers project memory settings over user settings', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-settings-memory-scope-'));
    const projectRoot = path.join(root, 'project');
    const userHome = path.join(root, 'home');

    try {
      await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
      await mkdir(path.join(userHome, '.codara'), {recursive: true});

      await writeFile(path.join(projectRoot, '.codara', 'settings.json'), JSON.stringify({
        memory: {autoGlobal: false},
      }, null, 2));
      await writeFile(path.join(userHome, '.codara', 'settings.json'), JSON.stringify({
        memory: {autoGlobal: true},
      }, null, 2));

      expect(resolveAutoMemoryGlobal({projectRoot, userHome})).toBe(false);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('defaults plugin and memory settings to enabled when no settings exist', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-settings-default-'));
    const projectRoot = path.join(root, 'project');
    const userHome = path.join(root, 'home');

    try {
      await mkdir(projectRoot, {recursive: true});
      await mkdir(userHome, {recursive: true});

      expect(resolvePluginInstallGlobal({projectRoot, userHome})).toBe(true);
      expect(resolveAutoMemoryGlobal({projectRoot, userHome})).toBe(true);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('returns scoped paths alongside parsed project and user settings', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-settings-scoped-'));
    const projectRoot = path.join(root, 'project');
    const userHome = path.join(root, 'home');

    try {
      await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
      await mkdir(path.join(userHome, '.codara'), {recursive: true});
      await writeFile(path.join(projectRoot, '.codara', 'settings.json'), JSON.stringify({
        plugins: {installGlobal: false},
      }, null, 2));
      await writeFile(path.join(userHome, '.codara', 'settings.json'), JSON.stringify({
        memory: {autoGlobal: false},
      }, null, 2));

      expect(loadScopedCodaraSettings({projectRoot, userHome})).toEqual({
        projectRoot,
        userHome,
        projectPath: path.join(projectRoot, '.codara', 'settings.json'),
        userPath: path.join(userHome, '.codara', 'settings.json'),
        project: {
          plugins: {installGlobal: false},
          memory: undefined,
        },
        user: {
          plugins: undefined,
          memory: {autoGlobal: false},
        },
      });
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
