import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runRealCliCase} from '../helpers/real-cli';

async function waitForCondition(
  predicate: () => Promise<boolean> | boolean,
  options: {timeoutMs?: number; intervalMs?: number} = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Condition was not satisfied before timeout');
}

describe('subagent prompt manual cases', () => {
  it('should make .codara/codara.md visible inside delegated child system prompts through the real CLI', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-subagent-prompt-'));
    const projectRoot = path.join(root, 'project');
    const codaraPath = path.join(projectRoot, '.codara');
    const skillAgentsDir = path.join(codaraPath, 'skills', 'delegates', 'agents');
    const demoSkillDir = path.join(codaraPath, 'skills', 'demo-skill');

    await mkdir(skillAgentsDir, {recursive: true});
    await mkdir(demoSkillDir, {recursive: true});
    await writeFile(path.join(codaraPath, 'codara.md'), 'PROJECT_HANDBOOK_RULE\nAlways summarize what handbook rules you followed.', 'utf8');
    await writeFile(path.join(projectRoot, 'AGENTS.md'), 'PROJECT_AGENTS_RULE\nRespect the workspace playbook.', 'utf8');
    await writeFile(
      path.join(demoSkillDir, 'SKILL.md'),
      `---
name: demo-skill
description: demo-skill
---
# Demo Skill
`,
      'utf8',
    );
    await writeFile(
      path.join(skillAgentsDir, 'agent.md'),
      `---
name: Agent
description: Reserved Agent base child override
---
RESERVED_DEFAULT_PROFILE_PROMPT
`,
      'utf8',
    );

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'delegate prompt check',
      scenario: 'prompt-manual-inheritance',
    });
    const runRecordPath = path.join(codaraPath, 'case-task-runs', 'call_prompt_task.json');

    expect(result.exitCode).toBe(0);

    await waitForCondition(async () => {
      try {
        const raw = await readFile(runRecordPath, 'utf8');
        const runRecord = JSON.parse(raw) as {status?: string};
        return runRecord.status === 'completed';
      } catch {
        return false;
      }
    });

    const runRecord = JSON.parse(await readFile(runRecordPath, 'utf8')) as {
      status?: string;
      summary?: string;
    };
    expect(runRecord.status).toBe('completed');
    expect(runRecord.summary).toContain('prompt_visible:true;guidelines_visible:true;skills_visible:true;profile_visible:false');
  });
});
