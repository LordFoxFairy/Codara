import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runRealCliCase} from '../helpers/real-cli';

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
      path.join(skillAgentsDir, 'general-purpose.md'),
      `---
name: general-purpose
description: Default general-purpose subagent
---
You are the default general-purpose subagent.
`,
      'utf8',
    );

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'delegate prompt check',
      scenario: 'prompt-manual-inheritance',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('PARENT_PROMPT_DONE');
    const compact = result.output.replace(/\s+/g, '');
    expect(compact).toContain('prompt_visible:true;guidelines_visible:true;skills_visible:true;profile_vi');
    expect(compact).toContain('sible:true');
  });
});
