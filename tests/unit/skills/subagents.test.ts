import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {filterToolsByReferences} from '@tools';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {loadSkillsRuntimeData, resolveSubagentDefinition} from '@capability/skill';
import {FileSystemSkillStore} from '@capability/skill';

function createBuiltinSubagentStore() {
  return new FileSystemSkillStore({
    sources: [path.join(process.cwd(), '.codara', 'skills')],
    cacheTtlMs: 0,
  });
}

describe('skill subagent definitions', () => {
  it('应解析 builtin subagent definitions', async () => {
    const store = createBuiltinSubagentStore();
    const runtime = await loadSkillsRuntimeData(store);
    const explore = resolveSubagentDefinition(runtime, 'Explore');
    const plan = resolveSubagentDefinition(runtime, 'Plan');
    const general = resolveSubagentDefinition(runtime, 'Agent');

    expect(explore.name).toBe('Explore');
    expect(explore.tools).toEqual(['read', 'glob', 'grep', 'fetch', 'search']);
    expect(explore.systemPrompt).toContain('You are an Explore subagent.');
    expect(explore.systemPrompt).toContain('fresh child session');
    expect(explore.systemPrompt).toContain('Do not edit files');
    expect(explore.systemPrompt).toContain('Do not delegate further');
    expect(plan.name).toBe('Plan');
    expect(plan.tools).toEqual(['read', 'glob', 'grep', 'fetch', 'search']);
    expect(plan.systemPrompt).toContain('You are a Plan subagent.');
    expect(plan.systemPrompt).toContain('fresh child session');
    expect(plan.systemPrompt).toContain('Do not edit files');
    expect(plan.systemPrompt).toContain('Do not delegate further');
    expect(general.name).toBe('Agent');
    expect(general.systemPrompt).toContain('You are a background worker agent');
  });

  it('应忽略保留的 Agent 基础 child profile 文件，并拒绝旧的隐式或 legacy 名称', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-agent-reserved-default-profile-'));

    try {
      const skillDir = path.join(root, 'custom-agents');
      const agentsDir = path.join(skillDir, 'agents');
      await mkdir(agentsDir, {recursive: true});
      await writeFile(path.join(skillDir, 'SKILL.md'), `---
name: custom-agents
description: custom subagent profiles
---
# Custom agents
`, 'utf8');
      await writeFile(path.join(agentsDir, 'general-purpose.md'), `---
name: general-purpose
description: custom general-purpose override
---
You are a custom general-purpose subagent.
`, 'utf8');

      const runtime = await loadSkillsRuntimeData(new FileSystemSkillStore({sources: [root], cacheTtlMs: 0}));
      const general = resolveSubagentDefinition(runtime, 'Agent');

      expect(general.name).toBe('Agent');
      expect(general.systemPrompt).toContain('You are a background worker agent');
      expect(general.description).not.toContain('custom general-purpose override');
      expect(() => resolveSubagentDefinition(runtime, undefined)).toThrow(
        'Agent requires subagent_type. Use "Agent" for the base child or a named profile such as "Explore".',
      );
      expect(() => resolveSubagentDefinition(runtime, 'general-purpose')).toThrow(
        'Unknown subagent_type "general-purpose"',
      );
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('应让 subagent definition 工具引用匹配 Codara 默认工具名', async () => {
    const explore = resolveSubagentDefinition(await loadSkillsRuntimeData(createBuiltinSubagentStore()), 'Explore');
    const filtered = filterToolsByReferences([
      tool(async () => 'ok', {name: 'read_file', description: 'read', schema: z.object({})}),
      tool(async () => 'ok', {name: 'fetch_url', description: 'fetch', schema: z.object({})}),
      tool(async () => 'ok', {name: 'web_search', description: 'search', schema: z.object({})}),
      tool(async () => 'ok', {name: 'write_file', description: 'write', schema: z.object({})}),
    ], explore.tools ?? []);

    expect(filtered.map((candidate) => candidate.name)).toEqual(['read_file', 'fetch_url', 'web_search']);
  });

  it('应支持从独立 subagent roots 发现 definition', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-agent-root-'));

    try {
      await writeFile(path.join(root, 'Reviewer.md'), `---
name: Reviewer
description: direct subagent root reviewer
tools:
  - read
permissionMode: plan
---
You are a Reviewer subagent loaded from a standalone agents root.
`, 'utf8');

      const reviewer = resolveSubagentDefinition(
        await loadSkillsRuntimeData(new FileSystemSkillStore({sources: []}), [root]),
        'Reviewer'
      );

      expect(reviewer.name).toBe('Reviewer');
      expect(reviewer.description).toBe('direct subagent root reviewer');
      expect(reviewer.tools).toEqual(['read']);
      expect(reviewer.hints?.permissionMode).toBe('plan');
      expect(reviewer.systemPrompt).toContain('standalone agents root');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('应从 skill agents 目录解析并覆盖 subagent definition', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-agent-profiles-'));

    try {
      const skillDir = path.join(root, 'custom-agents');
      const agentsDir = path.join(skillDir, 'agents');
      await mkdir(agentsDir, {recursive: true});
      await writeFile(path.join(skillDir, 'SKILL.md'), `---
name: custom-agents
description: custom subagent profiles
---
# Custom agents
`, 'utf8');
      await writeFile(path.join(agentsDir, 'Explore.md'), `---
name: Explore
description: project override
tools:
  - read
  - grep
maxTurns: 12
---
You are a project-specific Explore subagent.
Focus on the repo conventions first.
`, 'utf8');
      await writeFile(path.join(agentsDir, 'Researcher.md'), `---
name: Researcher
description: custom research agent
tools:
  - read
  - search
model: reviewer
middleware:
  - profile-tag
permissionMode: plan
---
You are a Researcher subagent.
`, 'utf8');

      const store = new FileSystemSkillStore({sources: [root], cacheTtlMs: 0});
      const runtime = await loadSkillsRuntimeData(store);
      const explore = resolveSubagentDefinition(runtime, 'Explore');
      const researcher = resolveSubagentDefinition(runtime, 'Researcher');

      expect(explore.description).toBe('project override');
      expect(explore.tools).toEqual(['read', 'grep']);
      expect(explore.maxTurns).toBe(12);
      expect(explore.systemPrompt).toContain('project-specific Explore subagent');

      expect(researcher.name).toBe('Researcher');
      expect(researcher.tools).toEqual(['read', 'search']);
      expect(researcher.hints?.model).toBe('reviewer');
      expect(researcher.hints?.middlewareNames).toEqual(['profile-tag']);
      expect(researcher.hints?.permissionMode).toBe('plan');
      expect(researcher.systemPrompt).toContain('Researcher subagent');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('应兼容无 frontmatter 的 Claude-style agent markdown', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-agent-frontmatterless-'));

    try {
      const skillDir = path.join(root, 'claude-imported-skill');
      const agentsDir = path.join(skillDir, 'agents');
      await mkdir(agentsDir, {recursive: true});
      await writeFile(path.join(skillDir, 'SKILL.md'), `---
name: claude-imported-skill
description: imported skill with plain markdown agents
---
# Imported skill
`, 'utf8');
      await writeFile(path.join(agentsDir, 'analyzer.md'), `# Post-hoc Analyzer Agent

Analyze blind comparison results and produce improvement suggestions.
`, 'utf8');

      const runtime = await loadSkillsRuntimeData(new FileSystemSkillStore({sources: [root], cacheTtlMs: 0}));
      const analyzer = resolveSubagentDefinition(runtime, 'analyzer');

      expect(analyzer.name).toBe('analyzer');
      expect(analyzer.description).toBe('Post-hoc Analyzer Agent');
      expect(analyzer.systemPrompt).toContain('Analyze blind comparison results');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
