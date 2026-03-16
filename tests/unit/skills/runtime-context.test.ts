import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AIMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {createAgent} from '@engine/agent';
import {createAgentMemoryCheckpointer} from '@infra/checkpoint';
import {createSkillsMiddleware} from '@engine/pipeline';
import {FileSystemSkillStore, loadSkillsRuntimeData} from '@capability/skill';

class SingleResponseModel {
  async invoke() {
    return new AIMessage('done');
  }

  bindTools() {
    return this;
  }
}

describe('skills runtime context boundary', () => {
  it('should keep skills runtime data out of persisted checkpoint context', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-skills-runtime-context-'));

    try {
      const skillDir = path.join(root, 'demo-skill');
      const agentsDir = path.join(skillDir, 'agents');
      await mkdir(agentsDir, {recursive: true});
      await writeFile(
        path.join(skillDir, 'SKILL.md'),
        `---
name: demo-skill
description: runtime skill
---
# Demo
`,
        'utf8',
      );
      await writeFile(
        path.join(agentsDir, 'Reviewer.md'),
        `---
name: Reviewer
description: review agent
---
You are a Reviewer subagent.
`,
        'utf8',
      );

      const checkpointer = createAgentMemoryCheckpointer();
      const agent = createAgent({
        model: new SingleResponseModel() as unknown as BaseChatModel,
        sessionId: 'skills-runtime-context-session',
        checkpointer,
        middleware: [
          createSkillsMiddleware({
            store: new FileSystemSkillStore({sources: [root], cacheTtlMs: 0}),
            loadRuntime: loadSkillsRuntimeData,
          }),
        ],
      });

      await agent.invoke('hello');
      const checkpoint = await checkpointer.getLatest('skills-runtime-context-session');

      expect(checkpoint?.state.context).toEqual({});
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
