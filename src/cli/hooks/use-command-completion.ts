import {useCallback, useEffect, useMemo, useState} from 'react';
import type {CodaraCommandSpec} from '@capability/command/runtime/types';

export interface CompletionItem {
  kind: 'command' | 'argument';
  value: string;
  label: string;
  description: string;
  sourceLabel: string;
  usage: string;
  commandName: string;
  aliases: string[];
}

export interface CompletionHint {
  title: string;
  label: string;
  description: string;
  sourceLabel: string;
  usage: string;
  aliases: string[];
}

export interface CommandCompletionState {
  visible: boolean;
  items: CompletionItem[];
  selectedIndex: number;
  prefix: string;
  title: string;
  hint?: CompletionHint;
}

export interface UseCommandCompletionInput {
  text: string;
  disabled: boolean;
  listCommands: () => Promise<readonly CodaraCommandSpec[]>;
}

export interface UseCommandCompletionOutput {
  completion: CommandCompletionState;
  moveUp: () => void;
  moveDown: () => void;
  accept: () => string | undefined;
  dismiss: () => void;
}

interface CommandSpecItem {
  name: string;
  description: string;
  sourceLabel: string;
  usage: string;
  aliases: string[];
}

interface CommandNameCompletionMatch {
  kind: 'command-name';
  prefix: string;
}

interface CommandArgumentCompletionMatch {
  kind: 'argument';
  command: CommandSpecItem;
  argPrefix: string;
}

type CommandCompletionMatch = CommandNameCompletionMatch | CommandArgumentCompletionMatch;

const MAX_VISIBLE_ITEMS = 20;

export function matchCommandPrefix(text: string): string | undefined {
  const match = resolveCommandCompletionMatch(text, []);
  return match?.kind === 'command-name' ? match.prefix : undefined;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function findCommandSpec(
  commands: readonly CommandSpecItem[],
  nameOrAlias: string,
): CommandSpecItem | undefined {
  const target = normalize(nameOrAlias);
  if (!target) {
    return undefined;
  }

  return commands.find((item) => (
    item.name.toLowerCase() === target
    || item.aliases.some((alias) => alias.toLowerCase() === target)
  ));
}

function resolveCommandContext(
  text: string,
  commands: readonly CommandSpecItem[],
): {command?: CommandSpecItem; argsText?: string} | undefined {
  if (!text.startsWith('/')) {
    return undefined;
  }

  const body = text.slice(1);
  if (!body.includes(' ')) {
    return {
      command: findCommandSpec(commands, body),
    };
  }

  const firstSpaceIndex = body.indexOf(' ');
  const commandName = body.slice(0, firstSpaceIndex).trim();
  if (!commandName) {
    return {};
  }

  return {
    command: findCommandSpec(commands, commandName),
    argsText: body.slice(firstSpaceIndex + 1),
  };
}

export function resolveCommandCompletionMatch(
  text: string,
  commands: readonly CommandSpecItem[],
): CommandCompletionMatch | undefined {
  if (!text.startsWith('/')) {
    return undefined;
  }

  const body = text.slice(1);
  if (!body.includes(' ')) {
    return {kind: 'command-name', prefix: body};
  }

  const firstSpaceIndex = body.indexOf(' ');
  const commandName = body.slice(0, firstSpaceIndex).trim();
  if (!commandName) {
    return {kind: 'command-name', prefix: ''};
  }

  const command = findCommandSpec(commands, commandName);
  if (!command) {
    return undefined;
  }

  const argsText = body.slice(firstSpaceIndex + 1);
  const trimmedArgs = argsText.trim();
  if (!trimmedArgs) {
    return {kind: 'argument', command, argPrefix: ''};
  }

  const segments = trimmedArgs.split(/\s+/);
  if (segments.length > 1) {
    return undefined;
  }

  return {
    kind: 'argument',
    command,
    argPrefix: segments[0] ?? '',
  };
}

function getCompletionValue(item: CompletionItem): string {
  const legacyName = (item as CompletionItem & {name?: string}).name;
  return item.value || legacyName || '';
}

function getCompletionAliases(item: CompletionItem): readonly string[] {
  return item.aliases ?? [];
}

function scoreCommandItem(item: CompletionItem, prefix: string): number {
  const lower = prefix.toLowerCase();
  const primaryValue = getCompletionValue(item);
  const values = [primaryValue, ...getCompletionAliases(item)];

  let best = -1;
  for (const value of values) {
    if (value.toLowerCase() === lower) {
      best = Math.max(best, value === primaryValue ? 500 : 480);
      continue;
    }

    if (value.toLowerCase().startsWith(lower)) {
      best = Math.max(best, value === primaryValue ? 400 : 380);
      continue;
    }

    if (value.toLowerCase().includes(lower)) {
      best = Math.max(best, value === primaryValue ? 300 : 280);
    }
  }

  if (best < 0) {
    return -1;
  }

  return best + (item.sourceLabel === 'builtin' ? 20 : 0);
}

export function filterCommands(commands: readonly CompletionItem[], prefix: string): CompletionItem[] {
  if (!prefix) {
    return commands
      .filter((item) => item.sourceLabel === 'builtin')
      .slice(0, MAX_VISIBLE_ITEMS);
  }

  return commands
    .map((item, index) => ({item, index, score: scoreCommandItem(item, prefix)}))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      const leftValue = getCompletionValue(left.item);
      const rightValue = getCompletionValue(right.item);
      if (leftValue.length !== rightValue.length) {
        return leftValue.length - rightValue.length;
      }

      return left.index - right.index;
    })
    .slice(0, MAX_VISIBLE_ITEMS)
    .map((entry) => entry.item);
}

function scoreArgumentValue(value: string, prefix: string): number {
  const lower = prefix.toLowerCase();
  const normalizedValue = value.toLowerCase();
  if (!lower) {
    return 100;
  }
  if (normalizedValue === lower) {
    return 300;
  }
  if (normalizedValue.startsWith(lower)) {
    return 200;
  }
  if (normalizedValue.includes(lower)) {
    return 100;
  }
  return -1;
}

export function filterArgumentSuggestions(
  values: readonly string[],
  prefix: string,
  command: CommandSpecItem,
): CompletionItem[] {
  return values
    .map((value, index) => ({value, index, score: scoreArgumentValue(value, prefix)}))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (left.value.length !== right.value.length) {
        return left.value.length - right.value.length;
      }

      return left.index - right.index;
    })
    .slice(0, MAX_VISIBLE_ITEMS)
    .map((entry) => ({
      kind: 'argument' as const,
      value: entry.value,
      label: entry.value,
      description: command.description,
      sourceLabel: command.sourceLabel,
      usage: command.usage,
      commandName: command.name,
      aliases: [...command.aliases],
    }));
}

function formatSourceLabel(source: CodaraCommandSpec['source']): string {
  if (source.type === 'builtin') return 'builtin';
  return source.skillName || 'skill';
}

export function mapCommandSpecs(specs: readonly CodaraCommandSpec[]): CommandSpecItem[] {
  return specs.map((spec) => ({
    name: spec.name,
    description: spec.description,
    sourceLabel: formatSourceLabel(spec.source),
    usage: spec.usage,
    aliases: [...(spec.aliases ?? [])],
  }));
}

export function mapCommandItems(specs: readonly CommandSpecItem[]): CompletionItem[] {
  return specs.map((spec) => ({
    kind: 'command',
    value: spec.name,
    label: `/${spec.name}`,
    description: spec.description,
    sourceLabel: spec.sourceLabel,
    usage: spec.usage,
    commandName: spec.name,
    aliases: [...spec.aliases],
  }));
}

function stripUsageWrapper(value: string): string {
  return value.replace(/^[<[({]/, '').replace(/[>\])}]$/, '');
}

function isPlaceholderToken(value: string): boolean {
  return (/^[<[({]/.test(value) || /[>\])}]$/.test(value)) && !value.includes('|');
}

export function extractFirstArgumentSuggestions(command: CommandSpecItem): string[] {
  const branches = command.usage
    .split(/\s\|\s/)
    .map((branch) => branch.trim())
    .filter(Boolean);

  const values = new Set<string>();
  for (const branch of branches) {
    let remainder = branch;
    const commandPrefix = `/${command.name}`;
    if (remainder.startsWith(commandPrefix)) {
      remainder = remainder.slice(commandPrefix.length).trim();
    }

    const token = remainder.split(/\s+/)[0];
    if (!token) {
      continue;
    }

    const unwrapped = stripUsageWrapper(token);
    if (unwrapped.includes('|')) {
      for (const part of unwrapped.split('|').map((item) => item.trim()).filter(Boolean)) {
        values.add(part);
      }
      continue;
    }

    if (!isPlaceholderToken(token)) {
      values.add(unwrapped);
    }
  }

  return [...values];
}

function commandHasArguments(command: CompletionItem): boolean {
  return command.usage.trim() !== `/${command.commandName}`;
}

export function acceptCompletionText(
  text: string,
  item: CompletionItem,
): string {
  void text;

  if (item.kind === 'command') {
    return commandHasArguments(item) ? `${item.label} ` : item.label;
  }

  return `/${item.commandName} ${item.value}`;
}

function createHintFromCommand(command: CommandSpecItem, title: string): CompletionHint {
  return {
    title,
    label: `/${command.name}`,
    description: command.description,
    sourceLabel: command.sourceLabel,
    usage: command.usage,
    aliases: [...command.aliases],
  };
}

function createHintFromItem(item: CompletionItem): CompletionHint {
  if (item.kind === 'command') {
    return {
      title: 'Command',
      label: item.label,
      description: item.description,
      sourceLabel: item.sourceLabel,
      usage: item.usage,
      aliases: [...item.aliases],
    };
  }

  return {
    title: 'Argument',
    label: `${item.label} for /${item.commandName}`,
    description: item.description,
    sourceLabel: item.sourceLabel,
    usage: item.usage,
    aliases: [...item.aliases],
  };
}

export function resolveCommandHint(
  text: string,
  commands: readonly CommandSpecItem[],
  selectedItem?: CompletionItem,
): CompletionHint | undefined {
  if (selectedItem) {
    return createHintFromItem(selectedItem);
  }

  const context = resolveCommandContext(text, commands);
  if (!context?.command) {
    return undefined;
  }

  if (typeof context.argsText === 'string') {
    return createHintFromCommand(context.command, 'Usage');
  }

  return createHintFromCommand(context.command, 'Command');
}

export function useCommandCompletion(input: UseCommandCompletionInput): UseCommandCompletionOutput {
  const {text, disabled, listCommands} = input;
  const [allCommands, setAllCommands] = useState<CommandSpecItem[]>([]);
  const [selected, setSelected] = useState({text: '', index: 0});
  const [dismissedText, setDismissedText] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void listCommands().then((specs) => {
      if (!cancelled) {
        setAllCommands(mapCommandSpecs(specs));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [listCommands]);

  const match = useMemo(
    () => resolveCommandCompletionMatch(text, allCommands),
    [allCommands, text],
  );

  const items = useMemo(() => {
    if (!match) {
      return [];
    }

    if (match.kind === 'command-name') {
      return filterCommands(mapCommandItems(allCommands), match.prefix);
    }

    return filterArgumentSuggestions(
      extractFirstArgumentSuggestions(match.command),
      match.argPrefix,
      match.command,
    );
  }, [allCommands, match]);

  const effectiveSelectedIndex = selected.text === text
    ? Math.min(selected.index, Math.max(0, items.length - 1))
    : 0;
  const visible = !disabled && dismissedText !== text && items.length > 0;
  const selectedItem = visible ? items[effectiveSelectedIndex] : undefined;
  const resolvedHint = useMemo(
    () => resolveCommandHint(text, allCommands, selectedItem),
    [allCommands, selectedItem, text],
  );
  const hint = !disabled && dismissedText !== text ? resolvedHint : undefined;

  const moveUp = useCallback(() => {
    setSelected((current) => {
      const currentIndex = current.text === text
        ? Math.min(current.index, Math.max(0, items.length - 1))
        : 0;
      return {
        text,
        index: currentIndex > 0 ? currentIndex - 1 : items.length - 1,
      };
    });
  }, [items.length, text]);

  const moveDown = useCallback(() => {
    setSelected((current) => {
      const currentIndex = current.text === text
        ? Math.min(current.index, Math.max(0, items.length - 1))
        : 0;
      return {
        text,
        index: currentIndex < items.length - 1 ? currentIndex + 1 : 0,
      };
    });
  }, [items.length, text]);

  const accept = useCallback((): string | undefined => {
    if (!visible || items.length === 0) {
      return undefined;
    }

    return acceptCompletionText(text, items[effectiveSelectedIndex]!);
  }, [effectiveSelectedIndex, items, text, visible]);

  const dismiss = useCallback(() => {
    setDismissedText(text);
  }, [text]);

  return {
    completion: {
      visible,
      items,
      selectedIndex: effectiveSelectedIndex,
      prefix: match?.kind === 'argument' ? match.argPrefix : match?.prefix ?? '',
      title: match?.kind === 'argument' ? 'Arguments' : 'Commands',
      hint,
    },
    moveUp,
    moveDown,
    accept,
    dismiss,
  };
}
