import type {CodaraCommandDefinition} from '@capability/command/runtime/types';

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
      output: 'No model aliases configured.\nAdd models to .codara/config.json to get started.',
    };
  }

  const current = environment.modelAlias ?? 'default';
  const lines = aliases.map((alias, index) => {
    const num = `${index + 1}.`.padEnd(4);
    const active = alias === current ? ' (active)' : '';
    const marker = alias === current ? '› ' : '  ';
    return `${marker}${num}${alias}${active}`;
  });

  return {
    ok: true,
    command: commandName,
    output: [
      'Select Model',
      '',
      ...lines,
      '',
      `Run /model <alias> to switch, or esc to dismiss.`,
    ].join('\n'),
  };
}

async function switchModel(
  commandName: string,
  targetAlias: string,
  environment: {modelAlias?: string; modelAliases?: string[]; onModelSwitch?: (alias: string) => Promise<void> | void},
) {
  const aliases = environment.modelAliases ?? [];

  // Support numeric selection: /model 1 → first alias
  const numericIndex = Number(targetAlias);
  let resolvedAlias = targetAlias;
  if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= aliases.length) {
    resolvedAlias = aliases[numericIndex - 1]!;
  }

  if (aliases.length > 0 && !aliases.includes(resolvedAlias)) {
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
    await environment.onModelSwitch(resolvedAlias);
    return {
      ok: true,
      command: commandName,
      output: `Switched to model "${resolvedAlias}".`,
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
