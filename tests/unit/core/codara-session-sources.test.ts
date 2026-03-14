import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createCodara, FileSessionStore} from '@core';
import {createCodaraGuidelinesSource} from '@core/context/instructions/guidelines';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import type {SkillMetadata, SkillStore} from '@core/skills/types';
import {SystemEchoModel} from './codara-fixtures';

describe('Codara session source lifecycle', () => {
  it('should keep the same preloaded guidelines for the default session', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-session-sources-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await mkdir(nestedCwd, {recursive: true});
    await writeFile(path.join(nestedCwd, 'AGENTS.md'), 'project rule v1', 'utf8');

    const codara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      cwd: nestedCwd,
      userHome,
      skills: false,
      builtinTools: false,
    });

    const first = await codara.invoke('hello');
    const firstText = String(first.state.messages[first.state.messages.length - 1]?.content);
    expect(firstText).toContain('project rule v1');

    await writeFile(path.join(nestedCwd, 'AGENTS.md'), 'project rule v2', 'utf8');

    const second = await codara.invoke('again');
    const secondText = String(second.state.messages[second.state.messages.length - 1]?.content);
    expect(secondText).toContain('project rule v1');
    expect(secondText).not.toContain('project rule v2');
  });

  it('should load updated guidelines for a new session instance', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-session-refresh-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await mkdir(nestedCwd, {recursive: true});
    await writeFile(path.join(nestedCwd, 'AGENTS.md'), 'project rule v1', 'utf8');

    const firstCodara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      cwd: nestedCwd,
      userHome,
      skills: false,
      builtinTools: false,
    });
    await firstCodara.invoke('hello');

    await writeFile(path.join(nestedCwd, 'AGENTS.md'), 'project rule v2', 'utf8');

    const secondCodara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      cwd: nestedCwd,
      userHome,
      skills: false,
      builtinTools: false,
    });
    const result = await secondCodara.invoke('hello');
    const text = String(result.state.messages[result.state.messages.length - 1]?.content);

    expect(text).toContain('project rule v2');
    expect(text).not.toContain('project rule v1');
  });

  it('should reload source projections for the same Codara session when reloadSources is called', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-session-reload-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await mkdir(nestedCwd, {recursive: true});
    await writeFile(path.join(nestedCwd, 'AGENTS.md'), 'project rule v1', 'utf8');

    const codara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      cwd: nestedCwd,
      sessionId: 'reload-sources-session',
      userHome,
      skills: false,
      builtinTools: false,
    });

    const first = await codara.invoke('hello');
    const firstText = String(first.state.messages[first.state.messages.length - 1]?.content);
    expect(firstText).toContain('project rule v1');

    await writeFile(path.join(nestedCwd, 'AGENTS.md'), 'project rule v2', 'utf8');

    await codara.reloadSources();
    const second = await codara.invoke('again');
    const secondText = String(second.state.messages[second.state.messages.length - 1]?.content);

    expect(secondText).toContain('project rule v2');
    expect(secondText).not.toContain('project rule v1');
  });

  it('should persist session activity metadata when session sources are reloaded', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-session-reload-metadata-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    const store = new FileSessionStore({
      basePath: path.join(root, 'sessions'),
    });
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await mkdir(nestedCwd, {recursive: true});
    await writeFile(path.join(nestedCwd, 'AGENTS.md'), 'project rule v1', 'utf8');

    const codara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      cwd: nestedCwd,
      userHome,
      store,
      skills: false,
      builtinTools: false,
    });

    await codara.invoke('hello');
    const before = codara.getState();

    await new Promise((resolve) => setTimeout(resolve, 5));
    await codara.reloadSources();

    const after = codara.getState();
    expect(after.updatedAt > before.updatedAt).toBe(true);

    const persisted = await store.get(after.sessionId);
    expect(persisted?.updatedAt).toBe(after.updatedAt);
    expect(persisted?.metadata?.lastActivity).toBe(after.metadata?.lastActivity);
  });

  it('should preload skills runtime at session bootstrap and reuse it on the later model call', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-session-skills-bootstrap-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.git'), {recursive: true});

    let discoverCalls = 0;
    const store: SkillStore = {
      async discover(): Promise<SkillMetadata[]> {
        discoverCalls += 1;
        return [
          {
            name: 'bootstrap-skill',
            description: 'session-owned preload',
            path: path.join(projectRoot, '.codara', 'skills', 'bootstrap-skill', 'SKILL.md'),
          },
        ];
      },
      listSources() {
        return [path.join(projectRoot, '.codara', 'skills')];
      },
    };

    const codara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      projectRoot,
      userHome,
      skills: {store},
      builtinTools: false,
    });

    await codara.hydrate();
    expect(discoverCalls).toBe(1);

    await codara.invoke('hello');
    expect(discoverCalls).toBe(1);
  });

  it('should load .codara/codara.md into the session system prompt and refresh it after reloadSources', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-session-prompt-reload-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'codara.md'), 'project handbook v1', 'utf8');

    const codara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      projectRoot,
      userHome,
      skills: false,
      builtinTools: false,
    });

    const first = await codara.invoke('hello');
    const firstText = String(first.state.messages[first.state.messages.length - 1]?.content);
    expect(firstText).toContain('project handbook v1');

    await writeFile(path.join(projectRoot, '.codara', 'codara.md'), 'project handbook v2', 'utf8');

    const second = await codara.invoke('again');
    const secondText = String(second.state.messages[second.state.messages.length - 1]?.content);
    expect(secondText).toContain('project handbook v1');
    expect(secondText).not.toContain('project handbook v2');

    await codara.reloadSources();
    const third = await codara.invoke('after reload');
    const thirdText = String(third.state.messages[third.state.messages.length - 1]?.content);
    expect(thirdText).toContain('project handbook v2');
    expect(thirdText).not.toContain('project handbook v1');
  });

  it('should add deeper AGENTS.md rules on the next turn after a file tool hits that subtree', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-session-guidelines-disclosure-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const targetFile = path.join(projectRoot, 'packages', 'app', 'src', 'feature.ts');

    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await mkdir(path.dirname(targetFile), {recursive: true});
    await writeFile(path.join(projectRoot, 'AGENTS.md'), 'ROOT_RULE', 'utf8');
    await writeFile(path.join(projectRoot, 'packages', 'app', 'AGENTS.md'), 'APP_RULE', 'utf8');
    await writeFile(targetFile, 'export const feature = true;\n', 'utf8');

    const codara = createCodara({
      model: new ProgressiveDisclosureModel(targetFile, 'APP_RULE') as unknown as BaseChatModel,
      projectRoot,
      cwd: projectRoot,
      userHome,
      skills: false,
      builtinTools: false,
      tools: [createSessionReadFileTool()],
    });

    const result = await codara.invoke('inspect the feature file');
    const text = String(result.state.messages[result.state.messages.length - 1]?.content);

    expect(text).toBe('visible:true');
  });

  it('should no-op when a file tool hits a subtree without deeper instruction files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-session-noop-guidelines-'));
    await writeFile(path.join(root, 'AGENTS.md'), '# root rule\nstay at root\n', 'utf8');
    await mkdir(path.join(root, 'packages/plain'), {recursive: true});
    await writeFile(path.join(root, 'packages/plain/file.ts'), 'export const plain = true;\n', 'utf8');

    const guidelinesSource = createCodaraGuidelinesSource({cwd: root, projectRoot: root, userHome: root});

    const bootstrap = await guidelinesSource.getBootstrapContent();
    expect(bootstrap).toContain('stay at root');

    const changed = await guidelinesSource.activateTarget({
      path: path.join(root, 'packages/plain/file.ts'),
      kind: 'file',
    });
    expect(changed).toBe(false);

    const progressive = await guidelinesSource.getProgressiveContent();
    expect(progressive).toBeUndefined();
  });

  it('should add deeper hidden handbook rules on the next turn after a file tool hits that subtree', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-session-prompt-disclosure-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const targetFile = path.join(projectRoot, 'packages', 'app', 'src', 'feature.ts');

    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, 'packages', 'app', '.codara'), {recursive: true});
    await mkdir(path.dirname(targetFile), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'codara.md'), 'ROOT_HANDBOOK', 'utf8');
    await writeFile(path.join(projectRoot, 'packages', 'app', '.codara', 'codara.md'), 'APP_HANDBOOK', 'utf8');
    await writeFile(targetFile, 'export const feature = true;\n', 'utf8');

    const codara = createCodara({
      model: new ProgressiveDisclosureModel(targetFile, 'APP_HANDBOOK') as unknown as BaseChatModel,
      projectRoot,
      cwd: projectRoot,
      userHome,
      skills: false,
      builtinTools: false,
      tools: [createSessionReadFileTool()],
    });

    const result = await codara.invoke('inspect the feature file');
    const text = String(result.state.messages[result.state.messages.length - 1]?.content);

    expect(text).toBe('visible:true');
  });

  it('should reload skills projections for the same Codara session only after reloadSources is called', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-session-skills-reload-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const skillDir = path.join(projectRoot, '.codara', 'skills', 'demo-skill');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await mkdir(skillDir, {recursive: true});
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: demo-skill
description: skill rule v1
---
# Demo
`,
      'utf8',
    );

    const codara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      projectRoot,
      userHome,
      skills: {
        projectRoot,
        userHome,
        cacheTtlMs: 0,
      },
      builtinTools: false,
    });

    const first = await codara.invoke('hello');
    const firstText = String(first.state.messages[first.state.messages.length - 1]?.content);
    expect(firstText).toContain('skill rule v1');

    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: demo-skill
description: skill rule v2
---
# Demo
`,
      'utf8',
    );

    const second = await codara.invoke('again');
    const secondText = String(second.state.messages[second.state.messages.length - 1]?.content);
    expect(secondText).toContain('skill rule v1');
    expect(secondText).not.toContain('skill rule v2');

    await codara.reloadSources();
    const third = await codara.invoke('after reload');
    const thirdText = String(third.state.messages[third.state.messages.length - 1]?.content);
    expect(thirdText).toContain('skill rule v2');
    expect(thirdText).not.toContain('skill rule v1');
  });
});

class ProgressiveDisclosureModel {
  constructor(
    private readonly targetFile: string,
    private readonly expectedRule: string,
  ) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const toolMessage = messages.find((message) => (
      ToolMessage.isInstance(message) && message.tool_call_id === 'call_progressive_read'
    )) as ToolMessage | undefined;

    if (!toolMessage) {
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_progressive_read',
          name: 'read_file',
          args: {path: this.targetFile},
        } as ToolCall],
      });
    }

    const systemText = messages
      .filter((message): message is SystemMessage => SystemMessage.isInstance(message))
      .map((message) => String(message.content))
      .join('\n');
    const runtimeInstructionText = messages
      .filter((message): message is HumanMessage => HumanMessage.isInstance(message))
      .map((message) => String(message.content))
      .join('\n');

    return new AIMessage(`visible:${runtimeInstructionText.includes(this.expectedRule) && !systemText.includes(this.expectedRule)}`);
  }

  bindTools(): this {
    return this;
  }
}

function createSessionReadFileTool() {
  return tool(
    async ({path: targetPath}: {path: string}) => readFile(targetPath, 'utf8'),
    {
      name: 'read_file',
      description: 'Read file content for progressive disclosure tests',
      schema: z.object({path: z.string()}),
    },
  );
}
