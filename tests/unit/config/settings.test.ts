import {describe, expect, it} from 'bun:test';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readCodaraSettings, resolveTeamsEnabled} from '@/config';

describe('codara settings', () => {
  it('reads teams.enabled from settings.json', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-settings-'));
    const settingsPath = path.join(root, 'settings.json');

    try {
      await writeFile(settingsPath, JSON.stringify({
        teams: {
          enabled: true,
        },
      }, null, 2));

      expect(readCodaraSettings(settingsPath)).toEqual({
        teams: {
          enabled: true,
        },
      });
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('prefers project teams.enabled over user settings', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-settings-scope-'));
    const projectRoot = path.join(root, 'project');
    const userHome = path.join(root, 'home');

    try {
      await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
      await mkdir(path.join(userHome, '.codara'), {recursive: true});

      await writeFile(path.join(projectRoot, '.codara', 'settings.json'), JSON.stringify({
        teams: {enabled: false},
      }, null, 2));
      await writeFile(path.join(userHome, '.codara', 'settings.json'), JSON.stringify({
        teams: {enabled: true},
      }, null, 2));

      expect(resolveTeamsEnabled({projectRoot, userHome})).toBe(false);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('defaults teams to disabled when no settings exist', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-settings-default-'));
    const projectRoot = path.join(root, 'project');
    const userHome = path.join(root, 'home');

    try {
      await mkdir(projectRoot, {recursive: true});
      await mkdir(userHome, {recursive: true});

      expect(resolveTeamsEnabled({projectRoot, userHome})).toBe(false);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
