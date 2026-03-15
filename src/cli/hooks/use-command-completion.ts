import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {CodaraCommandSpec} from '@core/commands/types';

export interface CompletionItem {
  name: string;
  description: string;
  sourceLabel: string;
}

export interface CommandCompletionState {
  visible: boolean;
  items: CompletionItem[];
  selectedIndex: number;
  prefix: string;
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

const MAX_VISIBLE_ITEMS = 8;

export function matchCommandPrefix(text: string): string | undefined {
  // Only match when the entire text is a single slash command (no spaces before the slash)
  const match = text.match(/^\/(\S*)$/);
  return match ? match[1]! : undefined;
}

export function filterCommands(commands: readonly CompletionItem[], prefix: string): CompletionItem[] {
  if (!prefix) return commands.slice(0, MAX_VISIBLE_ITEMS);

  const lower = prefix.toLowerCase();
  return commands
    .filter(cmd => cmd.name.toLowerCase().includes(lower))
    .slice(0, MAX_VISIBLE_ITEMS);
}

function formatSourceLabel(source: CodaraCommandSpec['source']): string {
  if (source.type === 'builtin') return 'builtin';
  return source.skillName || 'skill';
}

export function mapCommandSpecs(specs: readonly CodaraCommandSpec[]): CompletionItem[] {
  return specs.map(spec => ({
    name: spec.name,
    description: spec.description,
    sourceLabel: formatSourceLabel(spec.source),
  }));
}

export function useCommandCompletion(input: UseCommandCompletionInput): UseCommandCompletionOutput {
  const {text, disabled, listCommands} = input;
  const [allCommands, setAllCommands] = useState<CompletionItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const lastTextRef = useRef('');

  // Load commands once
  useEffect(() => {
    let cancelled = false;
    void listCommands().then(specs => {
      if (!cancelled) {
        setAllCommands(mapCommandSpecs(specs));
      }
    });
    return () => { cancelled = true; };
  }, [listCommands]);

  // Reset dismissed state when text changes
  useEffect(() => {
    if (text !== lastTextRef.current) {
      lastTextRef.current = text;
      setDismissed(false);
      setSelectedIndex(0);
    }
  }, [text]);

  const prefix = useMemo(() => matchCommandPrefix(text), [text]);
  const items = useMemo(
    () => prefix !== undefined ? filterCommands(allCommands, prefix) : [],
    [allCommands, prefix],
  );

  const visible = !disabled && !dismissed && prefix !== undefined && items.length > 0;

  const moveUp = useCallback(() => {
    setSelectedIndex(current => current > 0 ? current - 1 : items.length - 1);
  }, [items.length]);

  const moveDown = useCallback(() => {
    setSelectedIndex(current => current < items.length - 1 ? current + 1 : 0);
  }, [items.length]);

  const accept = useCallback((): string | undefined => {
    if (!visible || items.length === 0) return undefined;
    const safeIndex = Math.min(selectedIndex, items.length - 1);
    return `/${items[safeIndex]!.name}`;
  }, [visible, items, selectedIndex]);

  const dismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  return {
    completion: {
      visible,
      items,
      selectedIndex: Math.min(selectedIndex, Math.max(0, items.length - 1)),
      prefix: prefix ?? '',
    },
    moveUp,
    moveDown,
    accept,
    dismiss,
  };
}
