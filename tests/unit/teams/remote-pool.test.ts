import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { RemotePool, type RemoteAgentConfig } from '../../../src/capability/team/remote-pool.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codara-pool-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

function makeConfig(name: string, url = 'https://example.com'): RemoteAgentConfig {
  return { name, url };
}

describe('RemotePool', () => {
  test('load() with no file returns empty pool', async () => {
    const pool = new RemotePool(tempDir);
    await pool.load();
    expect(pool.listRemotes()).toEqual([]);
  });

  test('load() with existing file populates pool', async () => {
    const data = { remoteAgents: [makeConfig('agent-a', 'https://a.dev')] };
    await fs.writeFile(path.join(tempDir, 'remotes.json'), JSON.stringify(data));

    const pool = new RemotePool(tempDir);
    await pool.load();
    expect(pool.listRemotes()).toEqual([{ name: 'agent-a', url: 'https://a.dev' }]);
  });

  test('addRemote adds and persists', async () => {
    const pool = new RemotePool(tempDir);
    await pool.load();
    await pool.addRemote(makeConfig('bot-1', 'https://bot1.dev'));

    // Verify in-memory
    expect(pool.listRemotes()).toHaveLength(1);

    // Verify on disk by loading a fresh pool
    const pool2 = new RemotePool(tempDir);
    await pool2.load();
    expect(pool2.listRemotes()).toEqual([{ name: 'bot-1', url: 'https://bot1.dev' }]);
  });

  test('addRemote with duplicate name throws', async () => {
    const pool = new RemotePool(tempDir);
    await pool.load();
    await pool.addRemote(makeConfig('dup'));
    await expect(pool.addRemote(makeConfig('dup'))).rejects.toThrow('Remote "dup" already exists');
  });

  test('removeRemote removes and persists', async () => {
    const pool = new RemotePool(tempDir);
    await pool.load();
    await pool.addRemote(makeConfig('to-remove'));
    await pool.addRemote(makeConfig('to-keep'));
    await pool.removeRemote('to-remove');

    expect(pool.listRemotes()).toEqual([makeConfig('to-keep')]);

    // Verify persistence
    const pool2 = new RemotePool(tempDir);
    await pool2.load();
    expect(pool2.listRemotes()).toEqual([makeConfig('to-keep')]);
  });

  test('removeRemote non-existent throws', async () => {
    const pool = new RemotePool(tempDir);
    await pool.load();
    await expect(pool.removeRemote('ghost')).rejects.toThrow('Remote "ghost" not found');
  });

  test('getRemote returns correct agent', async () => {
    const pool = new RemotePool(tempDir);
    await pool.load();
    await pool.addRemote(makeConfig('target', 'https://target.dev'));
    await pool.addRemote(makeConfig('other', 'https://other.dev'));

    const result = pool.getRemote('target');
    expect(result).toEqual({ name: 'target', url: 'https://target.dev' });
  });

  test('getRemote non-existent returns undefined', async () => {
    const pool = new RemotePool(tempDir);
    await pool.load();
    expect(pool.getRemote('nope')).toBeUndefined();
  });

  test('listRemotes returns all agents (defensive copy)', async () => {
    const pool = new RemotePool(tempDir);
    await pool.load();
    await pool.addRemote(makeConfig('a'));
    await pool.addRemote(makeConfig('b'));
    await pool.addRemote(makeConfig('c'));

    const list = pool.listRemotes();
    expect(list).toHaveLength(3);

    // Mutating the returned list should not affect the pool
    list.pop();
    expect(pool.listRemotes()).toHaveLength(3);
  });
});
