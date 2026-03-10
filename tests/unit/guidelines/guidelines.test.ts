import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createGuidelinesMiddleware} from '@core/middleware/guidelines';
import {createCodaraAgentsSource} from '@core/sessions/agents-source';
import type {BeforeModelContext} from '@core/middleware';

describe('AGENTS guidelines', () => {
  it('should resolve the nearest AGENTS.md from cwd', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-guidelines-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    const globalFile = path.join(userHome, '.codara', 'AGENTS.md');
    const projectFile = path.join(projectRoot, 'AGENTS.md');
    const packageFile = path.join(projectRoot, 'packages', 'AGENTS.md');
    const appFile = path.join(nestedCwd, 'AGENTS.md');

    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(nestedCwd, {recursive: true});
    await writeFile(globalFile, '# Global Rules\n\nKeep commits small.\n', 'utf8');
    await writeFile(projectFile, '# Project Rules\n\nRun tests before merge.\n', 'utf8');
    await writeFile(packageFile, '# Package Rules\n\nUse package lint first.\n', 'utf8');
    await writeFile(appFile, '# App Rules\n\nPrefer feature flags.\n', 'utf8');

    const agentsSource = createCodaraAgentsSource({userHome, cwd: nestedCwd});
    const content = await agentsSource?.getContent();

    expect(content).toBeDefined();
    expect(content).toContain('# Global Rules');
    expect(content).toContain('# Project Rules');
    expect(content).toContain('# Package Rules');
    expect(content).toContain('# App Rules');
  });

  it('should load guidelines from project root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-guidelines-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const globalFile = path.join(userHome, '.codara', 'AGENTS.md');
    const projectFile = path.join(projectRoot, 'AGENTS.md');

    await mkdir(path.dirname(globalFile), {recursive: true});
    await mkdir(projectRoot, {recursive: true});
    await writeFile(globalFile, '# Global Rules\n\nKeep commits small.\nUse Chinese comments when helpful.\n', 'utf8');
    await writeFile(projectFile, '# Project Rules\n\nUse pnpm only.\nRun tests before merge.\n', 'utf8');

    const agentsSource = createCodaraAgentsSource({userHome, projectRoot});
    const content = await agentsSource?.getContent();

    expect(content).toBeDefined();
    expect(content).toContain('# Global Rules');
    expect(content).toContain('# Project Rules');
    expect(content).toContain('Run tests before merge.');
  });

  it('should inject preloaded guideline content', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-guidelines-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const projectFile = path.join(projectRoot, 'AGENTS.md');

    await mkdir(projectRoot, {recursive: true});
    await writeFile(projectFile, '# Original rule.\n', 'utf8');

    const agentsSource = createCodaraAgentsSource({userHome, projectRoot});
    const middleware = createGuidelinesMiddleware(agentsSource);
    const context: BeforeModelContext = {
      state: {messages: []},
      messages: [],
      runtime: {context: {}, agentContext: {}},
      systemMessage: ['base system'],
      runId: 'run_1',
      turn: 1,
      maxTurns: 8,
      requestId: 'req_1',
    };

    await middleware.beforeModel?.(context);
    expect(context.systemMessage[1]).toContain('Original rule.');
  });

  it('should preserve root-to-cwd guideline order in loaded files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-guidelines-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    const globalFile = path.join(userHome, '.codara', 'AGENTS.md');
    const projectFile = path.join(projectRoot, 'AGENTS.md');
    const packageFile = path.join(projectRoot, 'packages', 'AGENTS.md');
    const appFile = path.join(nestedCwd, 'AGENTS.md');

    await mkdir(path.dirname(globalFile), {recursive: true});
    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await mkdir(nestedCwd, {recursive: true});
    await writeFile(globalFile, '# Global Rules\n', 'utf8');
    await writeFile(projectFile, '# Project Rules\n', 'utf8');
    await writeFile(packageFile, '# Package Rules\n', 'utf8');
    await writeFile(appFile, '# App Rules\n', 'utf8');

    const agentsSource = createCodaraAgentsSource({userHome, cwd: nestedCwd});
    const content = await agentsSource?.getContent();

    expect(content).toBeDefined();
    const text = content ?? '';
    expect(text.indexOf('# Global Rules')).toBeLessThan(text.indexOf('# Project Rules'));
    expect(text.indexOf('# Project Rules')).toBeLessThan(text.indexOf('# Package Rules'));
    expect(text.indexOf('# Package Rules')).toBeLessThan(text.indexOf('# App Rules'));
  });

  it('should expand @imports inside guideline files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-guidelines-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const importedFile = path.join(projectRoot, 'shared-guidelines.md');
    const projectFile = path.join(projectRoot, 'AGENTS.md');

    await mkdir(projectRoot, {recursive: true});
    await writeFile(importedFile, '# Shared Rules\n\nPrefer narrow commits.\n', 'utf8');
    await writeFile(projectFile, '# Project Rules\n\n@./shared-guidelines.md\n\nRun tests before merge.\n', 'utf8');

    const agentsSource = createCodaraAgentsSource({userHome, projectRoot});
    const content = await agentsSource?.getContent();

    expect(content).toBeDefined();
    expect(content).toContain('# Project Rules');
    expect(content).toContain('# Shared Rules');
    expect(content).toContain('Prefer narrow commits.');
    expect(content).toContain('Run tests before merge.');
  });
});
