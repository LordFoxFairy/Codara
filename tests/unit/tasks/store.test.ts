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

  it('应在写入 addBlockedBy 时同步更新前置任务的 blocks', async () => {
    const store = createTaskMemoryStore();
    const prerequisite = await store.create({
      subject: 'Design schema',
      description: 'Plan the graph',
    });
    const blocked = await store.create({
      subject: 'Implement worker',
      description: 'Build the worker',
    });

    const updated = await store.update({
      taskId: blocked.id,
      addBlockedBy: [prerequisite.id],
    });
    const refreshedPrerequisite = await store.get(prerequisite.id);

    expect(updated.blockedBy).toEqual([prerequisite.id]);
    expect(refreshedPrerequisite?.blocks).toEqual([blocked.id]);
  });

  it('应在写入 addBlocks 时同步更新目标任务的 blockedBy', async () => {
    const store = createTaskMemoryStore();
    const prerequisite = await store.create({
      subject: 'Design schema',
      description: 'Plan the graph',
    });
    const blocked = await store.create({
      subject: 'Implement worker',
      description: 'Build the worker',
    });

    const updated = await store.update({
      taskId: prerequisite.id,
      addBlocks: [blocked.id],
    });
    const refreshedBlocked = await store.get(blocked.id);

    expect(updated.blocks).toEqual([blocked.id]);
    expect(refreshedBlocked?.blockedBy).toEqual([prerequisite.id]);
  });

  it('应拒绝自依赖和不存在的任务引用', async () => {
    const store = createTaskMemoryStore();
    const task = await store.create({
      subject: 'Design schema',
      description: 'Plan the graph',
    });

    await expect(store.update({
      taskId: task.id,
      addBlockedBy: [task.id],
    })).rejects.toThrow(`Task "${task.id}" cannot depend on itself`);

    await expect(store.update({
      taskId: task.id,
      addBlockedBy: ['missing-task'],
    })).rejects.toThrow('Task "missing-task" not found');
  });

  it('应拒绝明显的 dependency cycle', async () => {
    const store = createTaskMemoryStore();
    const first = await store.create({
      subject: 'First',
      description: 'First task',
    });
    const second = await store.create({
      subject: 'Second',
      description: 'Second task',
    });

    await store.update({
      taskId: second.id,
      addBlockedBy: [first.id],
    });

    await expect(store.update({
      taskId: first.id,
      addBlockedBy: [second.id],
    })).rejects.toThrow(`Adding dependency ${second.id} -> ${first.id} would create a cycle`);
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

  it('file store 应持久化双向 dependency graph', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'codara-task-store-graph-'));

    try {
      const first = createTaskFileStore({rootDir});
      const prerequisite = await first.create({
        subject: 'Design schema',
        description: 'Plan the graph',
      });
      const blocked = await first.create({
        subject: 'Implement worker',
        description: 'Build the worker',
      });

      await first.update({
        taskId: blocked.id,
        addBlockedBy: [prerequisite.id],
      });

      const second = createTaskFileStore({rootDir});
      const persistedPrerequisite = await second.get(prerequisite.id);
      const persistedBlocked = await second.get(blocked.id);

      expect(persistedPrerequisite?.blocks).toEqual([blocked.id]);
      expect(persistedBlocked?.blockedBy).toEqual([prerequisite.id]);
    } finally {
      await rm(rootDir, {recursive: true, force: true});
    }
  });
});
