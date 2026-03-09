import {describe, expect, it} from 'bun:test';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createTaskFileStore, createTaskMemoryStore} from '@core/tasks';

describe('task store', () => {
  it('应支持创建、列出和更新共享任务', async () => {
    const store = createTaskMemoryStore();
    const created = await store.create({
      subject: 'Implement auth',
      description: 'Build the authentication flow',
      activeForm: 'Implementing auth',
    });

    expect(created.status).toBe('pending');
    expect(created.blocks).toEqual([]);
    expect(created.blockedBy).toEqual([]);

    const updated = await store.update({
      taskId: created.id,
      status: 'in_progress',
      owner: 'main-agent',
    });

    expect(updated.status).toBe('in_progress');
    expect(updated.owner).toBe('main-agent');

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.subject).toBe('Implement auth');
  });

  it('应在前置任务未完成时拒绝将任务标记为 in_progress', async () => {
    const store = createTaskMemoryStore();
    const prerequisite = await store.create({
      subject: 'Design schema',
      description: 'Plan the task graph',
    });
    const blocked = await store.create({
      subject: 'Implement worker',
      description: 'Build the actual execution path',
    });

    await store.update({
      taskId: blocked.id,
      addBlockedBy: [prerequisite.id],
    });

    await expect(store.update({
      taskId: blocked.id,
      status: 'in_progress',
    })).rejects.toThrow(`Task "${blocked.id}" is blocked by: ${prerequisite.id}`);

    await store.update({
      taskId: prerequisite.id,
      status: 'completed',
    });

    const updated = await store.update({
      taskId: blocked.id,
      status: 'in_progress',
    });

    expect(updated.status).toBe('in_progress');
  });

  it('file store 应跨实例持久化任务', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'codara-task-store-'));

    try {
      const first = createTaskFileStore({rootDir});
      const created = await first.create({
        subject: 'Persist tasks',
        description: 'Keep tasks on disk',
      });

      const second = createTaskFileStore({rootDir});
      const listed = await second.list();

      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe(created.id);
      expect(listed[0]?.subject).toBe('Persist tasks');
    } finally {
      await rm(rootDir, {recursive: true, force: true});
    }
  });
});
