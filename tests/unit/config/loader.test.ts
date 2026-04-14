import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadCodaraSettings} from '@config/loader';

async function createTempEnv() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codara-config-'));
  const projectRoot = path.join(root, 'project');
  const userHome = path.join(root, 'home');
  await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
  await mkdir(path.join(userHome, '.codara'), {recursive: true});
  return {root, projectRoot, userHome};
}

describe('loadCodaraSettings', () => {
  it('should return defaults when no config files exist', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      const settings = await loadCodaraSettings({projectRoot, userHome, skipEnv: true});
      expect(settings.model).toBeUndefined();
      expect(settings.maxTurns).toBeUndefined();
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should load user settings', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      await writeFile(path.join(userHome, '.codara', 'settings.json'), JSON.stringify({model: 'opus', maxTurns: 25}));
      const settings = await loadCodaraSettings({projectRoot, userHome, skipEnv: true});
      expect(settings.model).toBe('opus');
      expect(settings.maxTurns).toBe(25);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should let project settings override user settings', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      await writeFile(path.join(userHome, '.codara', 'settings.json'), JSON.stringify({model: 'opus', maxTurns: 25}));
      await writeFile(path.join(projectRoot, '.codara', 'settings.json'), JSON.stringify({model: 'sonnet'}));
      const settings = await loadCodaraSettings({projectRoot, userHome, skipEnv: true});
      expect(settings.model).toBe('sonnet');
      expect(settings.maxTurns).toBe(25);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should let local settings override project settings', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      await writeFile(path.join(projectRoot, '.codara', 'settings.json'), JSON.stringify({model: 'sonnet', maxTurns: 50}));
      await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({model: 'haiku'}));
      const settings = await loadCodaraSettings({projectRoot, userHome, skipEnv: true});
      expect(settings.model).toBe('haiku');
      expect(settings.maxTurns).toBe(50);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should handle malformed JSON gracefully', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      await writeFile(path.join(userHome, '.codara', 'settings.json'), '{invalid json');
      const settings = await loadCodaraSettings({projectRoot, userHome, skipEnv: true});
      expect(settings).toBeDefined();
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should validate with schema and strip invalid fields', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      await writeFile(path.join(userHome, '.codara', 'settings.json'), JSON.stringify({model: 'opus', permissions: {defaultMode: 'invalid_mode'}}));
      const settings = await loadCodaraSettings({projectRoot, userHome, skipEnv: true});
      expect(settings.model).toBe('opus');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should include MCP and hooks from unified settings', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      await writeFile(path.join(projectRoot, '.codara', 'settings.json'), JSON.stringify({
        mcpServers: {fs: {command: 'npx', args: ['server']}},
        hooks: {PreToolUse: [{command: 'echo test', timeout: 5000}]},
      }));
      const settings = await loadCodaraSettings({projectRoot, userHome, skipEnv: true});
      expect(settings.mcpServers?.fs).toBeDefined();
      expect(settings.hooks?.PreToolUse).toHaveLength(1);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
