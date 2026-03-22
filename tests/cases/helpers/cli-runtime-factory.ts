import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage, type ToolCall, SystemMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {
  createCodaraRuntime,
  ensurePermissionSettingsFile,
  persistPermissionRule,
  type Codara,
} from '@/index';
import {
  createAskUserQuestionMiddleware,
  createPermissionMiddleware,
  createSkillsMiddleware,
  parseAskUserResult,
} from '@core/middleware';
import {
  createTaskCreateTool,
  createTaskFileStore,
  createTaskListTool,
  createTaskUpdateTool,
  TASK_CREATE_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
} from '@capability/task';
import {createAgentRunFileStore, AGENT_TOOL_NAME, createAgentTool, createAgentMiddleware} from '@capability/subagent';
import {FileSystemSkillStore, loadSkillsRuntimeData} from '@capability/skill';
import {seedProjectSkillFixtures} from '../../helpers/project-skill-fixtures';

const createCliCaseRuntime = async (options: Parameters<typeof createCodaraRuntime>[0]) => (
  createCodaraRuntime({
    ...options,
    autoMemory: false,
  })
);

export async function createCliRuntime(input: {
  cwd: string;
  initialPrompt: string;
  modelAlias: string;
  sessionId?: string;
}): Promise<{codara: Codara; modelAlias?: string}> {
  const scenario = process.env.CODARA_CLI_CASE_SCENARIO?.trim();
  const repoRoot = process.env.CODARA_CLI_REPO_ROOT?.trim() || process.cwd();

  switch (scenario) {
    case 'task-skill-workflow':
      await seedProjectSkillFixtures(input.cwd);
      await seedPermissions(input.cwd, ['Read(*)']);
      return {
        codara: await createCliCaseRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new SkillAwareScriptedModel(
            'basic-task-flow',
            path.join(input.cwd, '.codara', 'skills', 'basic-task-flow', 'SKILL.md'),
            path.join(input.cwd, '.codara', 'skills', 'basic-task-flow', 'references', 'checklist.md'),
          ) as unknown as BaseChatModel,
          tools: [createReadFileTool()],
          builtinTools: false,
          skills: {
            store: createProjectSkillStore(input.cwd),
            subagentRoots: [path.join(repoRoot, '.codara', 'skills', 'builtin-agents', 'agents')],
          },
        }),
      };
    case 'task-skill-delegate': {
      await seedProjectSkillFixtures(input.cwd);
      const store = createTaskFileStore({rootDir: path.join(input.cwd, '.codara', 'case-tasks')});
      const runStore = createAgentRunFileStore({
        rootDir: path.join(input.cwd, '.codara', 'case-task-runs'),
      });
      return {
          codara: await createCliCaseRuntime({
            cwd: input.cwd,
            projectRoot: input.cwd,
            codaraPath: path.join(input.cwd, '.codara'),
            ...(input.sessionId ? {sessionId: input.sessionId} : {}),
            agentRunStore: runStore,
            model: new ScriptedModel([
            new AIMessage({
              content: '',
              tool_calls: [{
                id: 'call_task_create',
                name: TASK_CREATE_TOOL_NAME,
                args: {
                  subject: 'Inspect task-skill integration',
                  description: 'Verify delegated child can read shared tasks',
                },
              } as ToolCall],
            }),
            new AIMessage({
              content: '',
              tool_calls: [{
                id: 'call_task_delegate',
                name: AGENT_TOOL_NAME,
                args: {
                  prompt: 'Inspect shared tasks',
                  subagent_type: 'Agent',
                },
              } as ToolCall],
            }),
            new AIMessage('parent_done'),
          ]) as unknown as BaseChatModel,
          builtinTools: false,
          skills: {
            store: createProjectSkillStore(input.cwd),
            subagentRoots: [path.join(repoRoot, '.codara', 'skills', 'builtin-agents', 'agents')],
          },
          middleware: [createSkillsMiddleware({store: createProjectSkillStore(input.cwd), loadRuntime: loadSkillsRuntimeData})],
          tools: [
            createTaskCreateTool({store}),
            createAgentTool({
              model: new SharedTaskReaderModel() as unknown as BaseChatModel,
              tools: [createTaskListTool({store})],
              runStore,
            }),
          ],
        }),
      };
    }
    case 'prompt-manual-inheritance': {
      const promptRunStore = createAgentRunFileStore({
        rootDir: path.join(input.cwd, '.codara', 'case-task-runs'),
      });
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new ParentTaskPromptModel() as unknown as BaseChatModel,
          skills: {
            projectRoot: input.cwd,
            cacheTtlMs: 0,
            subagentRoots: [path.join(input.cwd, '.codara', 'skills', 'delegates', 'agents')],
          },
          tools: [createNoopTool()],
          builtinTools: false,
          middleware: [
            createAgentMiddleware({
              model: new ChildPromptInspectorModel() as unknown as BaseChatModel,
              tools: [createNoopTool()],
              runStore: promptRunStore,
            }),
          ],
        }),
      };
    }
    case 'multi-profile-coordination': {
      await seedPermissions(input.cwd, ['Read(*)', 'Grep(*)', 'Fetch(*)', 'Search(*)']);
      const store = createTaskFileStore({rootDir: path.join(input.cwd, '.codara', 'case-tasks')});
      const runStore = createAgentRunFileStore({
        rootDir: path.join(input.cwd, '.codara', 'case-task-runs'),
      });
      const childModel = new CoordinatedSubagentModel();
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new ParentScriptedModel([
            new AIMessage({
              content: '',
              tool_calls: [
                {
                  id: 'call_parent_task_create',
                  name: 'TaskCreate',
                  args: {
                    subject: 'Coordinate multi-subagent run',
                    description: 'Track plan, exploration, and implementation follow-up',
                  },
                } as ToolCall,
                {
                  id: 'call_parent_plan',
                  name: 'Agent',
                  args: {prompt: 'Create the implementation plan', subagent_type: 'Plan'},
                } as ToolCall,
                {
                  id: 'call_parent_explore',
                  name: 'Agent',
                  args: {prompt: 'Explore the current codebase state', subagent_type: 'Explore'},
                } as ToolCall,
                {
                  id: 'call_parent_general',
                  name: 'Agent',
                  args: {
                    prompt: 'Inspect the shared tasks and mark the active item in progress',
                    subagent_type: 'Agent',
                  },
                } as ToolCall,
              ],
            }),
          ]) as unknown as BaseChatModel,
          builtinTools: false,
          skills: {
            store: createRepoSkillStore(repoRoot),
            subagentRoots: [path.join(repoRoot, '.codara', 'skills', 'builtin-agents', 'agents')],
          },
          middleware: [
            createSkillsMiddleware({store: createRepoSkillStore(repoRoot), loadRuntime: loadSkillsRuntimeData}),
            createTaskMiddleware({
              store,
              runStore,
              model: childModel as unknown as BaseChatModel,
              tools: [
                tool(async ({path: targetPath}: {path: string}) => `plan-doc:${targetPath}`, {
                  name: 'read_file',
                  description: 'Read file content',
                  schema: z.object({path: z.string()}),
                }),
                tool(async ({pattern, path: targetPath}: {pattern: string; path: string}) => `grep-match:${pattern}@${targetPath}`, {
                  name: 'grep',
                  description: 'Search file content',
                  schema: z.object({pattern: z.string(), path: z.string()}),
                }),
                tool(async ({url}: {url: string}) => `fetch:${url}`, {
                  name: 'fetch_url',
                  description: 'Fetch url',
                  schema: z.object({url: z.string()}),
                }),
                tool(async ({query}: {query: string}) => `search:${query}`, {
                  name: 'web_search',
                  description: 'Search web',
                  schema: z.object({query: z.string()}),
                }),
                createTaskListTool({store}),
                createTaskUpdateTool({store}),
              ],
            }),
          ],
        }),
      };
    }
    case 'runtime-permission':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new PermissionRuntimeCliModel('touch guarded.txt', 'RUNTIME_PERMISSION_DONE') as unknown as BaseChatModel,
          tools: [createPermissionBashTool()],
          builtinTools: false,
          skills: false,
        }),
      };
    case 'runtime-git-status':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new PermissionRuntimeCliModel('git status', 'RUNTIME_GIT_STATUS_DONE') as unknown as BaseChatModel,
          tools: [createPermissionBashTool()],
          builtinTools: false,
          skills: false,
        }),
      };
    case 'runtime-git-status-wrapper':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new PermissionRuntimeCliModel('bash -lc "git status"', 'RUNTIME_GIT_STATUS_WRAPPER_DONE') as unknown as BaseChatModel,
          tools: [createPermissionBashTool()],
          builtinTools: false,
          skills: false,
        }),
      };
    case 'runtime-git-log-option':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new PermissionRuntimeCliModel('git -C ./tmp/repo log --oneline', 'RUNTIME_GIT_LOG_OPTION_DONE') as unknown as BaseChatModel,
          tools: [createPermissionBashTool()],
          builtinTools: false,
          skills: false,
        }),
      };
    case 'runtime-git-compound':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new PermissionRuntimeCliModel(
            'cd ./tmp/repo && git fetch origin && git push origin main',
            'RUNTIME_GIT_COMPOUND_DONE',
          ) as unknown as BaseChatModel,
          tools: [createPermissionBashTool()],
          builtinTools: false,
          skills: false,
        }),
      };
    case 'runtime-git-push':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new PermissionRuntimeCliModel('git push origin main', 'RUNTIME_GIT_PUSH_DONE') as unknown as BaseChatModel,
          tools: [createPermissionBashTool()],
          builtinTools: false,
          skills: false,
        }),
      };
    case 'runtime-write-permission':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new FilePermissionRuntimeCliModel('tmp/demo2/PLAN.md', 'RUNTIME_WRITE_PERMISSION_DONE') as unknown as BaseChatModel,
          tools: [createPermissionWriteTool()],
          builtinTools: false,
          skills: false,
        }),
      };
    case 'runtime-permission-other':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new PermissionRuntimeCliModel('mkdir guarded-dir', 'RUNTIME_PERMISSION_OTHER_DONE') as unknown as BaseChatModel,
          tools: [createPermissionBashTool()],
          builtinTools: false,
          skills: false,
        }),
      };
    case 'runtime-permission-mkdir-path':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new PermissionRuntimeCliModel('mkdir tmp/demo2', 'RUNTIME_PERMISSION_MKDIR_PATH_DONE') as unknown as BaseChatModel,
          tools: [createPermissionBashTool()],
          builtinTools: false,
          skills: false,
        }),
      };
    case 'runtime-permission-mkdir-path-other':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new PermissionRuntimeCliModel('mkdir tmp/demo3', 'RUNTIME_PERMISSION_MKDIR_PATH_OTHER_DONE') as unknown as BaseChatModel,
          tools: [createPermissionBashTool()],
          builtinTools: false,
          skills: false,
        }),
      };
    case 'runtime-permission-heredoc-path':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new PermissionRuntimeCliModel(
            `cat <<'EOF' > tmp/demo2/PLAN.md\nhello\nEOF`,
            'RUNTIME_PERMISSION_HEREDOC_PATH_DONE',
          ) as unknown as BaseChatModel,
          tools: [createPermissionBashTool()],
          builtinTools: false,
          skills: false,
        }),
      };
    case 'runtime-permission-heredoc-path-other':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new PermissionRuntimeCliModel(
            'touch tmp/demo2/README.md',
            'RUNTIME_PERMISSION_HEREDOC_PATH_OTHER_DONE',
          ) as unknown as BaseChatModel,
          tools: [createPermissionBashTool()],
          builtinTools: false,
          skills: false,
        }),
      };
    case 'runtime-permission-complex-path':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new PermissionRuntimeCliModel(
            'cat README.md | tee tmp/demo2/PLAN.md >/dev/null',
            'RUNTIME_PERMISSION_COMPLEX_PATH_DONE',
          ) as unknown as BaseChatModel,
          tools: [createPermissionBashTool()],
          builtinTools: false,
          skills: false,
        }),
      };
    case 'subagent-permission': {
      const permissionRunStore = createAgentRunFileStore({
        rootDir: path.join(input.cwd, '.codara', 'case-task-runs'),
      });
      return {
          codara: await createCodaraRuntime({
            cwd: input.cwd,
            projectRoot: input.cwd,
            codaraPath: path.join(input.cwd, '.codara'),
            ...(input.sessionId ? {sessionId: input.sessionId} : {}),
            agentRunStore: permissionRunStore,
            model: new ParentDelegationCliModel() as unknown as BaseChatModel,
          builtinTools: false,
          skills: {
            store: createRepoSkillStore(repoRoot),
            subagentRoots: [path.join(repoRoot, '.codara', 'skills', 'builtin-agents', 'agents')],
          },
          middleware: [createSkillsMiddleware({store: createRepoSkillStore(repoRoot), loadRuntime: loadSkillsRuntimeData})],
          tools: [
            createAgentTool({
              model: new ChildPermissionCliModel() as unknown as BaseChatModel,
              tools: [createPermissionBashTool()],
              middleware: [createPermissionCaseMiddleware(input.cwd)],
              runStore: permissionRunStore,
            }),
          ],
        }),
      };
    }
    case 'runtime-permission-repair':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new ScriptedModel([new AIMessage('PERMISSION_REPAIR_DONE')]) as unknown as BaseChatModel,
          builtinTools: false,
          skills: false,
        }),
      };
    case 'hil-form':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new HilFormCliModel() as unknown as BaseChatModel,
          builtinTools: false,
          skills: false,
          hil: false,
          middleware: [
            createAskUserQuestionMiddleware(),
          ],
        }),
      };
    case 'memory-project':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new ScriptedModel([new AIMessage('MEMORY_UNUSED')]) as unknown as BaseChatModel,
          builtinTools: false,
          skills: false,
        }),
      };
    case 'progressive-disclosure':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new ProgressiveDisclosureCliModel(path.join(input.cwd, 'packages', 'app', 'src', 'feature.ts')) as unknown as BaseChatModel,
          tools: [createReadFileTool()],
          builtinTools: false,
          skills: false,
        }),
      };
    case 'command-surface':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new ScriptedModel([new AIMessage('COMMAND_SURFACE_UNUSED')]) as unknown as BaseChatModel,
          builtinTools: false,
          skills: false,
        }),
      };
    case 'command-surface-skill-help':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new ScriptedModel([new AIMessage('COMMAND_SURFACE_SKILL_HELP_UNUSED')]) as unknown as BaseChatModel,
          builtinTools: false,
          skills: {
            store: createProjectSkillStore(input.cwd),
          },
        }),
      };
    case 'plugin-install':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new ScriptedModel([new AIMessage('PLUGIN_INSTALL_UNUSED')]) as unknown as BaseChatModel,
          builtinTools: false,
          skills: false,
        }),
      };
    case 'skill-command-preflight-missing-tool':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new ScriptedModel([new AIMessage('SKILL_PREFLIGHT_UNEXPECTED_MODEL_CALL')]) as unknown as BaseChatModel,
          builtinTools: false,
          skills: {
            store: createProjectSkillStore(input.cwd),
          },
        }),
      };
    case 'skill-command-preflight-missing-binary':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new ScriptedModel([new AIMessage('SKILL_PREFLIGHT_UNEXPECTED_MODEL_CALL')]) as unknown as BaseChatModel,
          builtinTools: true,
          skills: {
            store: createProjectSkillStore(input.cwd),
          },
        }),
      };
    case 'default-runtime-workflow':
      return {
        codara: await createCodaraRuntime({
          cwd: input.cwd,
          projectRoot: input.cwd,
          codaraPath: path.join(input.cwd, '.codara'),
          ...(input.sessionId ? {sessionId: input.sessionId} : {}),
          model: new DefaultRuntimeWorkflowCliModel() as unknown as BaseChatModel,
          builtinTools: false,
          skills: false,
        }),
      };
    default:
      throw new Error(`Unsupported real CLI case scenario: ${scenario || '(empty)'}`);
  }
}

async function seedPermissions(projectRoot: string, rules: string[]): Promise<void> {
  ensurePermissionSettingsFile({projectRoot});
  for (const rule of rules) {
    await persistPermissionRule(rule, 'allow', {projectRoot});
  }
}

function createRepoSkillStore(repoRoot: string): FileSystemSkillStore {
  return new FileSystemSkillStore({
    sources: [path.join(repoRoot, '.codara', 'skills')],
    cacheTtlMs: 0,
  });
}

function createProjectSkillStore(projectRoot: string): FileSystemSkillStore {
  return new FileSystemSkillStore({
    sources: [path.join(projectRoot, '.codara', 'skills')],
    cacheTtlMs: 0,
  });
}

class ScriptedModel {
  private index = 0;

  constructor(private readonly responses: AIMessage[]) {}

  async invoke(_messages: BaseMessage[]): Promise<AIMessage> {
    void _messages;
    const current = this.responses[this.index];
    if (!current) {
      throw new Error(`No fake response at index ${this.index}`);
    }
    this.index += 1;
    return current;
  }

  bindTools(_tools: StructuredToolInterface[]): this {
    void _tools;
    return this;
  }
}

class SkillAwareScriptedModel {
  private step = 0;

  constructor(
    private readonly skillName: string,
    private readonly skillPath: string,
    private readonly referencePath: string,
  ) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const joined = messages.map((message) => stringifyMessage(message.content)).join('\n');

    if (this.step === 0) {
      if (!joined.includes(this.skillName) || !joined.includes(this.skillPath)) {
        return new AIMessage('SKILL_NOT_VISIBLE');
      }
      this.step += 1;
      return new AIMessage({
        content: '',
        tool_calls: [{id: 'call_skill', name: 'read_file', args: {path: this.skillPath}} as ToolCall],
      });
    }

    if (this.step === 1) {
      this.step += 1;
      return new AIMessage({
        content: '',
        tool_calls: [{id: 'call_reference', name: 'read_file', args: {path: this.referencePath}} as ToolCall],
      });
    }

    return new AIMessage('TASK_DONE');
  }

  bindTools(_tools: StructuredToolInterface[]): this {
    void _tools;
    return this;
  }
}

class ProgressiveDisclosureCliModel {
  constructor(private readonly targetPath: string) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const toolMessage = findToolMessage(messages, 'call_progressive_disclosure_read');
    if (!toolMessage) {
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_progressive_disclosure_read',
          name: 'read_file',
          args: {path: this.targetPath},
        } as ToolCall],
      });
    }

    const systemText = messages
      .filter((message): message is SystemMessage => SystemMessage.isInstance(message))
      .map((message) => stringifyMessage(message.content))
      .join('\n');
    const runtimeInstructionText = messages
      .filter((message): message is HumanMessage => HumanMessage.isInstance(message))
      .map((message) => stringifyMessage(message.content))
      .join('\n');

    return new AIMessage(`PROGRESSIVE_DISCLOSURE_DONE:${runtimeInstructionText.includes('APP_RULE') || systemText.includes('APP_RULE')}`);
  }

  bindTools(_tools: StructuredToolInterface[]): this {
    void _tools;
    return this;
  }
}

class SharedTaskReaderModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const taskListMessage = messages.find((message) => (
      ToolMessage.isInstance(message) && message.tool_call_id === 'call_task_list'
    )) as ToolMessage | undefined;

    if (!taskListMessage) {
      return new AIMessage({
        content: '',
        tool_calls: [{id: 'call_task_list', name: TASK_LIST_TOOL_NAME, args: {}} as ToolCall],
      });
    }

    const sawTask = String(taskListMessage.content).includes('subject:');
    return new AIMessage(`shared_tasks_visible:${sawTask}`);
  }

  bindTools(_tools: StructuredToolInterface[]): this {
    void _tools;
    return this;
  }
}

class PermissionRuntimeCliModel {
  constructor(
    private readonly command: string,
    private readonly doneMessage: string,
  ) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const text = messages.map((message) => stringifyMessage(message.content)).join('\n');
    if (text.includes('Analyze this bash command for permission review.')) {
      return new AIMessage(JSON.stringify(buildPermissionClassifierResponse(this.command)));
    }
    if (text.includes(`executed:${this.command}`)) {
      return new AIMessage(this.doneMessage);
    }

    return new AIMessage({
      content: '',
      tool_calls: [{id: 'call_runtime_permission', name: 'bash', args: {command: this.command}} as ToolCall],
    });
  }

  bindTools(): this {
    return this;
  }
}

function buildPermissionClassifierResponse(command: string): {
  reason: string | null;
  pathScopeExpression: string | null;
  toolScopeExpression: string | null;
} {
  if (command.includes('tee tmp/demo2/PLAN.md')) {
    return {
      reason: 'Needs approval because this compound command writes under tmp/demo2/.',
      pathScopeExpression: 'Write(tmp/demo2/)',
      toolScopeExpression: null,
    };
  }

  return {
    reason: null,
    pathScopeExpression: null,
    toolScopeExpression: null,
  };
}

class FilePermissionRuntimeCliModel {
  constructor(
    private readonly filePath: string,
    private readonly doneMessage: string,
  ) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const text = messages.map((message) => stringifyMessage(message.content)).join('\n');
    if (text.includes(`written:${this.filePath}`)) {
      return new AIMessage(this.doneMessage);
    }

    return new AIMessage({
      content: '',
      tool_calls: [{
        id: 'call_runtime_write_permission',
        name: 'write_file',
        args: {
          file_path: this.filePath,
          content: '# Planned demo\n',
        },
      } as ToolCall],
    });
  }

  bindTools(): this {
    return this;
  }
}

class HilFormCliModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const askUserResult = messages
      .filter((message): message is ToolMessage => ToolMessage.isInstance(message))
      .map((message) => parseAskUserResult(message.content))
      .find((value): value is NonNullable<typeof value> => Boolean(value));
    if (askUserResult) {
      return new AIMessage(`HIL_FORM_DONE:${Object.keys(askUserResult.answers).join(',') || 'empty'}`);
    }

    return new AIMessage({
      content: '',
      tool_calls: [{
        id: 'call_hil_form',
        name: 'AskUserQuestion',
        args: {
          summary: 'A few structured inputs are missing before the agent can continue.',
          tab: 'Brief Intake',
          channel: 'clarification-center',
          questions: [
            {
              id: 'domain',
              label: 'Product Domain',
              question: 'Which product domain should this work target?',
              options: [
                {id: 'saas', label: 'SaaS product', description: 'General software or platform work.'},
                {id: 'infra', label: 'Infra tooling', description: 'Developer tooling and platform work.'},
              ],
              placeholder: 'Choose a domain or type your own answer.',
            },
            {
              id: 'scope',
              label: 'Target Scope',
              question: 'What scale should the first iteration target?',
              options: [
                {id: 'mvp', label: 'MVP', description: 'Keep the first pass intentionally small.'},
                {id: 'prod', label: 'Production', description: 'Aim at a complete production-ready pass.'},
              ],
              placeholder: 'Choose a scope or type your own answer.',
            },
          ],
        },
      } as ToolCall],
    });
  }

  bindTools(): this {
    return this;
  }
}

class ParentDelegationCliModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const text = messages.map((message) => stringifyMessage(message.content)).join('\n');
    if (text.includes('Subagent started in background.')) {
      return new AIMessage('SUBAGENT_PERMISSION_PARENT_DONE');
    }

    return new AIMessage({
      content: '',
      tool_calls: [{
        id: 'call_case_task_delegate',
        name: 'Agent',
        args: {prompt: 'Inspect the repo and run touch guarded.txt', subagent_type: 'Agent'},
      } as ToolCall],
    });
  }

  bindTools(): this {
    return this;
  }
}

class ChildPermissionCliModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const text = messages.map((message) => stringifyMessage(message.content)).join('\n');
    if (text.includes('executed:touch guarded.txt')) {
      return new AIMessage('SUBAGENT_PERMISSION_DONE');
    }

    return new AIMessage({
      content: '',
      tool_calls: [{id: 'call_subagent_permission', name: 'bash', args: {command: 'touch guarded.txt'}} as ToolCall],
    });
  }

  bindTools(): this {
    return this;
  }
}

class ParentTaskPromptModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const text = messages.map((message) => stringifyMessage(message.content)).join('\n');
    if (text.includes('Subagent started in background.')) {
      return new AIMessage('PARENT_PROMPT_DONE');
    }

    return new AIMessage({
      content: '',
      tool_calls: [{
        id: 'call_prompt_task',
        name: 'Agent',
        args: {
          prompt: 'Inspect your system prompt and report if the product handbook is visible.',
          subagent_type: 'Agent',
        },
      } as ToolCall],
    });
  }

  bindTools(): this {
    return this;
  }
}

class ChildPromptInspectorModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const systemMessages = messages
      .filter((message): message is SystemMessage => SystemMessage.isInstance(message))
      .map((message) => stringifyMessage(message.content))
      .join('\n');

    const sawPrompt = systemMessages.includes('PROJECT_HANDBOOK_RULE');
    const sawGuidelines = systemMessages.includes('PROJECT_AGENTS_RULE');
    const sawSkillsPrompt = systemMessages.includes('demo-skill');
    const sawProfilePrompt = systemMessages.includes('RESERVED_DEFAULT_PROFILE_PROMPT');

    return new AIMessage(
      `prompt_visible:${sawPrompt};guidelines_visible:${sawGuidelines};skills_visible:${sawSkillsPrompt};profile_visible:${sawProfilePrompt}`,
    );
  }

  bindTools(): this {
    return this;
  }
}

class ParentScriptedModel {
  private index = 0;

  constructor(private readonly responses: AIMessage[]) {}

  async invoke(_messages: BaseMessage[]): Promise<AIMessage> {
    void _messages;
    const current = this.responses[this.index];
    if (!current) {
      throw new Error(`No parent response at index ${this.index}`);
    }
    this.index += 1;
    return current;
  }

  bindTools(_tools: StructuredToolInterface[]): this {
    void _tools;
    return this;
  }
}

class DefaultRuntimeWorkflowCliModel {
  bindTools(_tools: StructuredToolInterface[]): this {
    void _tools;
    return this;
  }

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const text = messages.map((message) => stringifyMessage(message.content)).join('\n');

    if (text.includes('Inspect isolated child work') && !text.includes('Subagent started in background.')) {
      return new AIMessage('CHILD_FLOW_DONE');
    }

    if (text.includes('Subagent started in background.')) {
      return new AIMessage('DEFAULT_RUNTIME_FLOW_DONE');
    }

    if (text.includes('Task created.')) {
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_default_runtime_task',
          name: 'Agent',
          args: {
            prompt: 'Inspect isolated child work',
            subagent_type: 'Agent',
          },
        } as ToolCall],
      });
    }

    if (text.includes('Updated todo list to')) {
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_default_runtime_task_create',
          name: 'TaskCreate',
          args: {
            subject: 'Track default runtime workflow',
            description: 'Shared coordination state from the default runtime entry.',
          },
        } as ToolCall],
      });
    }

    return new AIMessage({
      content: '',
      tool_calls: [{
        id: 'call_default_runtime_todos',
        name: 'write_todos',
        args: {
          todos: [
            {content: 'Track default runtime workflow', status: 'in_progress'},
            {content: 'Review delegated child output', status: 'pending'},
          ],
        },
      } as ToolCall],
    });
  }
}

class CoordinatedSubagentModel {
  bindTools(_tools: StructuredToolInterface[]): this {
    void _tools;
    return this;
  }

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const systemText = messages
      .filter((message): message is SystemMessage => SystemMessage.isInstance(message))
      .map((message) => String(message.content))
      .join('\n');

    if (systemText.includes('You are a Plan subagent.')) {
      const readMessage = findToolMessage(messages, 'call_plan_read');
      if (!readMessage) {
        return new AIMessage({
          content: '',
          tool_calls: [{id: 'call_plan_read', name: 'read_file', args: {path: '/virtual/plan.md'}} as ToolCall],
        });
      }
      return new AIMessage(`PLAN_DONE:${String(readMessage.content).includes('plan-doc')}`);
    }

    if (systemText.includes('You are an Explore subagent.')) {
      const grepMessage = findToolMessage(messages, 'call_explore_grep');
      if (!grepMessage) {
        return new AIMessage({
          content: '',
          tool_calls: [{id: 'call_explore_grep', name: 'grep', args: {pattern: 'TODO', path: '/virtual/src'}} as ToolCall],
        });
      }
      return new AIMessage(`EXPLORE_DONE:${String(grepMessage.content).includes('grep-match:TODO')}`);
    }

    const taskListMessage = findToolMessage(messages, 'call_general_task_list');
    if (!taskListMessage) {
      return new AIMessage({
        content: '',
        tool_calls: [{id: 'call_general_task_list', name: TASK_LIST_TOOL_NAME, args: {}} as ToolCall],
      });
    }

    const taskUpdateMessage = findToolMessage(messages, 'call_general_task_update');
    if (!taskUpdateMessage) {
      const taskId = readFirstTaskId(String(taskListMessage.content));
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_general_task_update',
          name: 'TaskUpdate',
          args: {taskId, status: 'in_progress', owner: 'Agent'},
        } as ToolCall],
      });
    }

    return new AIMessage(`GENERAL_DONE:${String(taskUpdateMessage.content).includes('status: in_progress')}`);
  }
}

function createReadFileTool() {
  return tool(
    async ({path: targetPath}: {path: string}) => readFile(targetPath, 'utf8'),
    {
      name: 'read_file',
      description: 'Read file content',
      schema: z.object({path: z.string()}),
    },
  );
}

function createNoopTool() {
  return tool(async () => 'noop', {
    name: 'echo_tool',
    description: 'unused helper',
    schema: z.object({}),
  });
}

function createPermissionBashTool() {
  return tool(
    async ({command}: {command: string}) => `executed:${command}`,
    {
      name: 'bash',
      description: 'Execute shell command',
      schema: z.object({command: z.string()}),
    },
  );
}

function createPermissionWriteTool() {
  return tool(
    async ({file_path: filePath, content}: {file_path: string; content: string}) => `written:${filePath}:${content.length}`,
    {
      name: 'write_file',
      description: 'Write a file for permission runtime tests',
      schema: z.object({
        file_path: z.string(),
        content: z.string(),
      }),
    },
  );
}

function createPermissionCaseMiddleware(projectRoot: string) {
  return createPermissionMiddleware({
    cwd: projectRoot,
    projectRoot,
  });
}

function stringifyMessage(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => JSON.stringify(item)).join('\n');
  }
  return JSON.stringify(content);
}

function findToolMessage(messages: BaseMessage[], toolCallId: string): ToolMessage | undefined {
  return messages.find((message) => (
    ToolMessage.isInstance(message) && message.tool_call_id === toolCallId
  )) as ToolMessage | undefined;
}

function readFirstTaskId(content: string): string {
  const match = content.match(/- id: ([^ |\n]+)/);
  if (!match?.[1]) {
    throw new Error(`Unable to read task id from TaskList content:\n${content}`);
  }
  return match[1];
}
