import {describe, expect, it} from 'bun:test';
import {
  createTaskCreateTool,
  createTaskListTool,
  createTaskMemoryStore,
  createTaskUpdateTool,
} from '@capability/task';

describe('task tools', () => {
  it('应通过 TaskCreate/TaskList/TaskUpdate 操作共享任务', async () => {
    const store = createTaskMemoryStore();
    const createTool = createTaskCreateTool({store});
    const listTool = createTaskListTool({store});
    const updateTool = createTaskUpdateTool({store});

    const created = await createTool.invoke({
      subject: 'Implement auth',
      description: 'Build the authentication flow',
      activeForm: 'Implementing auth',
    });

    const [record] = await store.list();
    expect(String(created)).toContain('Task created.');
    expect(record?.subject).toBe('Implement auth');

    const updated = await updateTool.invoke({
      taskId: record?.id,
      status: 'in_progress',
      owner: 'subagent-a',
    });
    const listed = await listTool.invoke({});

    expect(String(updated)).toContain('status: in_progress');
    expect(String(updated)).toContain('owner: subagent-a');
    expect(String(listed)).toContain('Implement auth');
    expect(String(listed)).toContain('status: in_progress');
  });

  it('应在依赖未完成时让 TaskUpdate 返回阻塞错误', async () => {
    const store = createTaskMemoryStore();
    const updateTool = createTaskUpdateTool({store});

    const prerequisite = await store.create({
      subject: 'Plan schema',
      description: 'Define task dependencies',
    });
    const blocked = await store.create({
      subject: 'Write worker',
      description: 'Implement the worker logic',
    });

    await store.update({
      taskId: blocked.id,
      addBlockedBy: [prerequisite.id],
    });

    await expect(updateTool.invoke({
      taskId: blocked.id,
      status: 'in_progress',
    })).rejects.toThrow(`Task "${blocked.id}" is blocked by: ${prerequisite.id}`);
  });

  it('应通过单一写路径维护 blocks 与 blockedBy 的双向关系', async () => {
    const store = createTaskMemoryStore();
    const createTool = createTaskCreateTool({store});
    const updateTool = createTaskUpdateTool({store});

    await createTool.invoke({
      subject: 'Plan schema',
      description: 'Define task dependencies',
    });
    await createTool.invoke({
      subject: 'Write worker',
      description: 'Implement the worker logic',
    });

    const [prerequisite, blocked] = await store.list();
    await updateTool.invoke({
      taskId: blocked?.id,
      addBlockedBy: [prerequisite?.id ?? ''],
    });

    const refreshedPrerequisite = await store.get(prerequisite?.id ?? '');
    const refreshedBlocked = await store.get(blocked?.id ?? '');

    expect(refreshedPrerequisite?.blocks).toEqual([blocked?.id]);
    expect(refreshedBlocked?.blockedBy).toEqual([prerequisite?.id]);
  });

  it('不应再因遗留上下文元数据把共享任务协调结果隐藏成内部消息', async () => {
    const store = createTaskMemoryStore();
    const createTool = createTaskCreateTool({store});

    const created = await createTool.invoke(
      {
        subject: 'Align task semantics',
        description: 'Keep shared coordination visible to the caller',
      },
      {
        configurable: {
          runtimeShared: {
            legacyFocus: {id: 'legacy-workspace'},
          },
          context: {
            currentWorkspace: {id: 'legacy-workspace'},
          },
        },
      },
    );

    expect(String(created)).toContain('Task created.');
    expect(String(created)).toContain('Align task semantics');
    expect(String(created)).not.toContain('"type":"internal_shared_task_coordination"');
  });
});
