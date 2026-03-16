import type {CodaraCommandDefinition} from '@capability/command/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;

export const modelCommand: CodaraCommandDefinition = {
  name: 'model',
  usage: '/model [alias]',
  description: 'List available model aliases or switch to a different model.',
  source: BUILTIN_SOURCE,
  help: {
    executionMode: 'runtime_command',
  },
  async execute({command, environment}) {
    const targetAlias = command.args[0]?.trim();

    // 无参数：列出可用别名。
    if (!targetAlias) {
      return listAliases(command.name, environment);
    }

    // 有参数：切换模型。
    return switchModel(command.name, targetAlias, environment);
  },
};

function listAliases(
  commandName: string,
  environment: {modelAlias?: string; modelAliases?: string[]},
) {
  const aliases = environment.modelAliases ?? [];
  if (aliases.length === 0) {
    return {
      ok: true,
      command: commandName,
      output: 'No model aliases configured.',
    };
  }

  const current = environment.modelAlias ?? 'default';
  const lines = aliases.map((alias) =>
    alias === current ? `  * ${alias} (active)` : `    ${alias}`,
  );

  return {
    ok: true,
    command: commandName,
    output: [
      'Available models:',
      ...lines,
      '',
      'Run /model <alias> to switch.',
    ].join('\n'),
  };
}

async function switchModel(
  commandName: string,
  targetAlias: string,
  environment: {modelAlias?: string; modelAliases?: string[]; onModelSwitch?: (alias: string) => Promise<void> | void},
) {
  const aliases = environment.modelAliases ?? [];

  if (aliases.length > 0 && !aliases.includes(targetAlias)) {
    return {
      ok: false,
      command: commandName,
      output: `Unknown model alias: "${targetAlias}"\nAvailable: ${aliases.join(', ')}`,
    };
  }

  if (!environment.onModelSwitch) {
    return {
      ok: false,
      command: commandName,
      output: 'Model switching is not supported in this runtime.',
    };
  }

  try {
    await environment.onModelSwitch(targetAlias);
    return {
      ok: true,
      command: commandName,
      output: `Switched to model "${targetAlias}".`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      command: commandName,
      output: `Failed to switch model: ${message}`,
    };
  }
}
