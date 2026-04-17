process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason instanceof Error ? reason.message : String(reason));
});

import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {render} from 'ink';
import {createCodaraRuntime, DEFAULT_CODARA_MODEL_ALIAS, type Codara} from '@/index';
import type {CliReviewAutoAction} from './features/review/state-core';
import {parseCliArgs} from '@cli/cli-args';
import {runHeadless} from '@cli/headless';

const {CodaraCliApp} = await import('./app/shell-app');

const cwd = process.env.CODARA_CLI_CWD?.trim() || process.cwd();
const cliArgs = parseCliArgs(process.argv.slice(2));
const modelAlias = DEFAULT_CODARA_MODEL_ALIAS;

// Headless 模式：-p "prompt" 时直接执行并退出
if (cliArgs.headlessPrompt) {
  const {codara} = await createCliRuntime({
    cwd,
    initialPrompt: cliArgs.headlessPrompt,
    modelAlias,
    sessionId: cliArgs.resumeSessionId,
  });
  await runHeadless({
    codara,
    prompt: cliArgs.headlessPrompt,
    outputFormat: cliArgs.outputFormat,
  });
  process.exit(0);
}

// 交互模式
const initialRuntime = await createCliRuntime({
  cwd,
  initialPrompt: cliArgs.initialPrompt,
  modelAlias,
  sessionId: cliArgs.resumeSessionId,
});
const autoExitOnSettledPrompt = process.env.CODARA_CLI_AUTO_EXIT_AFTER_INITIAL_PROMPT === '1';
const reviewAutoActions = readReviewAutoActions(process.env.CODARA_CLI_REVIEW_AUTO_ACTIONS);

render(
  <CliRuntimeRoot
    cwd={cwd}
    initialPrompt={cliArgs.initialPrompt}
    initialRuntime={initialRuntime}
    modelAlias={modelAlias}
    reviewAutoActions={reviewAutoActions}
    autoExitOnSettledPrompt={autoExitOnSettledPrompt}
    startupMessage={cliArgs.resumeSessionId ? `Resumed session ${cliArgs.resumeSessionId}.` : undefined}
    openFile={openFileInHost}
  />,
);

interface CliRuntimeFactoryInput {
  cwd: string;
  initialPrompt: string;
  modelAlias: string;
  sessionId?: string;
}

interface CliRuntimeFactoryResult {
  codara: Codara;
  modelAlias?: string;
}

async function createCliRuntime(input: CliRuntimeFactoryInput): Promise<CliRuntimeFactoryResult> {
  const factoryModulePath = process.env.CODARA_CLI_RUNTIME_FACTORY?.trim();
  if (!factoryModulePath) {
    return {
      codara: await createCodaraRuntime({
        cwd: input.cwd,
        ...(input.sessionId ? {sessionId: input.sessionId} : {}),
      }),
      modelAlias: input.modelAlias,
    };
  }

  const moduleUrl = pathToFileURL(path.resolve(factoryModulePath)).href;
  const module = await import(moduleUrl) as {
    default?: (input: CliRuntimeFactoryInput) => Promise<CliRuntimeFactoryResult | Codara> | CliRuntimeFactoryResult | Codara;
    createCliRuntime?: (input: CliRuntimeFactoryInput) => Promise<CliRuntimeFactoryResult | Codara> | CliRuntimeFactoryResult | Codara;
  };
  const factory = module.createCliRuntime ?? module.default;
  if (!factory) {
    throw new Error(`CLI runtime factory does not export default or createCliRuntime: ${factoryModulePath}`);
  }

  const result = await factory(input);
  if (isCodara(result)) {
    return {codara: result, modelAlias: input.modelAlias};
  }

  return {
    codara: result.codara,
    modelAlias: result.modelAlias?.trim() || input.modelAlias,
  };
}

function isCodara(value: CliRuntimeFactoryResult | Codara): value is Codara {
  return typeof value === 'object'
    && value !== null
    && 'invoke' in value
    && typeof value.invoke === 'function'
    && 'stream' in value
    && typeof value.stream === 'function';
}

interface CliRuntimeRootProps {
  cwd: string;
  initialPrompt: string;
  initialRuntime: CliRuntimeFactoryResult;
  modelAlias: string;
  reviewAutoActions: CliReviewAutoAction[];
  autoExitOnSettledPrompt: boolean;
  startupMessage?: string;
  openFile: (targetPath: string) => Promise<boolean>;
}

function CliRuntimeRoot(props: CliRuntimeRootProps): React.JSX.Element {
  const [runtime, setRuntime] = React.useState(props.initialRuntime);
  const [startupMessage, setStartupMessage] = React.useState<string | undefined>(props.startupMessage);
  const [appInitialPrompt, setAppInitialPrompt] = React.useState(props.initialPrompt);

  const reopenSession = React.useCallback(async (sessionId: string) => {
    // Clear terminal before switching — Ink's <Static> content is permanently
    // in the scrollback buffer and can't be removed by React re-render.
    process.stdout.write('\x1b[2J\x1b[H');
    const nextRuntime = await createCliRuntime({
      cwd: props.cwd,
      initialPrompt: '',
      modelAlias: runtime.modelAlias ?? props.modelAlias,
      sessionId,
    });
    setRuntime(nextRuntime);
    setStartupMessage(`Resumed session ${sessionId.slice(0, 8)}…`);
    setAppInitialPrompt('');
  }, [props.cwd, props.modelAlias, runtime.modelAlias]);

  return (
    <CodaraCliApp
      key={runtime.codara.getState().sessionId}
      codara={runtime.codara}
      cwd={props.cwd}
      modelAlias={runtime.modelAlias ?? props.modelAlias}
      initialPrompt={appInitialPrompt}
      startupMessage={startupMessage}
      reviewAutoActions={props.reviewAutoActions}
      autoExitOnSettledPrompt={props.autoExitOnSettledPrompt}
      reopenSession={reopenSession}
      openFile={props.openFile}
    />
  );
}

async function openFileInHost(targetPath: string): Promise<boolean> {
  const editor = process.env.EDITOR?.trim();
  if (!editor) {
    return false;
  }

  return await new Promise<boolean>((resolve) => {
    const child = spawn(editor, [targetPath], {
      stdio: 'inherit',
      shell: true,
    });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

function readReviewAutoActions(raw: string | undefined): CliReviewAutoAction[] {
  const value = raw?.trim();
  if (!value) {
    return [];
  }

  if (value.startsWith('[')) {
    const parsed = JSON.parse(value) as Array<string | CliReviewAutoAction>;
    return parsed.map(normalizeReviewAutoAction);
  }

  return [normalizeReviewAutoAction(value)];
}

function normalizeReviewAutoAction(value: string | CliReviewAutoAction): CliReviewAutoAction {
  if (typeof value === 'string') {
    switch (value) {
      case 'always':
      case 'dont_ask_again':
        return {action: 'dont_ask_again'};
      case 'allow_tool':
        return {action: 'dont_ask_again', scope: 'tool'};
      case 'allow_project':
        return {action: 'dont_ask_again', scope: 'project'};
      case 'allow_path':
        return {action: 'dont_ask_again', scope: 'path'};
      default:
        return {action: value};
    }
  }

  return value;
}
