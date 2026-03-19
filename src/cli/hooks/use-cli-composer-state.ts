import {useCallback, useRef, useState} from 'react';
import {
  composeCliDraftText,
  createCliCollapsedPaste,
  summarizeCliCollapsedPastes,
  shouldCollapseCliPaste,
  type CliCollapsedPaste,
  type CliCollapsedPasteSummary,
} from '../composer/collapsed-paste';
import {
  backspaceComposerText,
  createComposerState,
  insertComposerNewline,
  insertComposerText,
  moveComposerCursorDownWithPreference,
  moveComposerCursorEnd,
  moveComposerCursorHome,
  moveComposerCursorLeft,
  moveComposerCursorRight,
  moveComposerCursorUpWithPreference,
  replaceComposerText,
} from '../composer/state';
import type {CliComposerState} from '../composer/types';
import {
  clearCliInputHistoryBrowse,
  createCliInputHistoryState,
  recallNextCliInputHistory,
  recallPreviousCliInputHistory,
  recordCliInputHistoryEntry,
} from './input-history-state';

export interface UseCliComposerStateOutput {
  composer: CliComposerState;
  draftText: string;
  hasDraftContent: boolean;
  collapsedPasteSummary?: CliCollapsedPasteSummary;
  composerActivityVersion: number;
  insertText: (input: string) => void;
  replaceText: (text: string) => void;
  insertNewline: () => void;
  backspace: () => void;
  moveCursorLeft: () => void;
  moveCursorRight: () => void;
  moveCursorUp: (terminalWidth?: number) => void;
  moveCursorDown: (terminalWidth?: number) => void;
  moveCursorHome: (terminalWidth?: number) => void;
  moveCursorEnd: (terminalWidth?: number) => void;
  isBrowsingHistory: boolean;
  recordHistoryEntry: (text: string) => void;
  recallPreviousHistory: () => boolean;
  recallNextHistory: () => boolean;
  resetComposer: () => void;
}

export function useCliComposerState(): UseCliComposerStateOutput {
  const [composer, setComposer] = useState(() => createComposerState());
  const [collapsedPastes, setCollapsedPastes] = useState<readonly CliCollapsedPaste[]>([]);
  const [composerActivityVersion, setComposerActivityVersion] = useState(0);
  const [historyState, setHistoryState] = useState(() => createCliInputHistoryState());
  const preferredVerticalColumnRef = useRef<number | undefined>(undefined);

  const applyComposerChange = useCallback((
    updater: (current: CliComposerState) => CliComposerState,
    options?: {preserveHistoryBrowse?: boolean; preserveVerticalColumn?: boolean},
  ) => {
    setComposer((current) => updater(current));
    if (!options?.preserveHistoryBrowse) {
      setHistoryState((current) => clearCliInputHistoryBrowse(current));
    }
    if (!options?.preserveVerticalColumn) {
      preferredVerticalColumnRef.current = undefined;
    }
    setComposerActivityVersion((current) => current + 1);
  }, []);

  const insertText = useCallback((input: string) => {
    if (shouldCollapseCliPaste(input, composer)) {
      setCollapsedPastes((current) => [...current, createCliCollapsedPaste(input)]);
      setHistoryState((current) => clearCliInputHistoryBrowse(current));
      preferredVerticalColumnRef.current = undefined;
      setComposerActivityVersion((current) => current + 1);
      return;
    }

    applyComposerChange((current) => insertComposerText(current, input));
  }, [applyComposerChange, composer]);

  const replaceText = useCallback((text: string) => {
    applyComposerChange(() => replaceComposerText(text));
  }, [applyComposerChange]);

  const insertNewline = useCallback(() => {
    applyComposerChange((current) => insertComposerNewline(current));
  }, [applyComposerChange]);

  const backspace = useCallback(() => {
    if (!composer.text && collapsedPastes.length > 0) {
      setCollapsedPastes((current) => current.slice(0, -1));
      setHistoryState((current) => clearCliInputHistoryBrowse(current));
      preferredVerticalColumnRef.current = undefined;
      setComposerActivityVersion((current) => current + 1);
      return;
    }

    applyComposerChange((current) => backspaceComposerText(current));
  }, [applyComposerChange, collapsedPastes.length, composer.text]);

  const moveCursorLeft = useCallback(() => {
    applyComposerChange((current) => moveComposerCursorLeft(current));
  }, [applyComposerChange]);

  const moveCursorRight = useCallback(() => {
    applyComposerChange((current) => moveComposerCursorRight(current));
  }, [applyComposerChange]);

  const moveCursorUp = useCallback((terminalWidth?: number) => {
    applyComposerChange((current) => {
      const result = moveComposerCursorUpWithPreference(current, terminalWidth, preferredVerticalColumnRef.current);
      preferredVerticalColumnRef.current = result.preferredColumn;
      return result.state;
    }, {preserveVerticalColumn: true});
  }, [applyComposerChange]);

  const moveCursorDown = useCallback((terminalWidth?: number) => {
    applyComposerChange((current) => {
      const result = moveComposerCursorDownWithPreference(current, terminalWidth, preferredVerticalColumnRef.current);
      preferredVerticalColumnRef.current = result.preferredColumn;
      return result.state;
    }, {preserveVerticalColumn: true});
  }, [applyComposerChange]);

  const moveCursorHome = useCallback((terminalWidth?: number) => {
    applyComposerChange((current) => moveComposerCursorHome(current, terminalWidth));
  }, [applyComposerChange]);

  const moveCursorEnd = useCallback((terminalWidth?: number) => {
    applyComposerChange((current) => moveComposerCursorEnd(current, terminalWidth));
  }, [applyComposerChange]);

  const recordHistoryEntry = useCallback((text: string) => {
    setHistoryState((current) => recordCliInputHistoryEntry(current, text));
  }, []);

  const draftText = composeCliDraftText(composer.text, collapsedPastes);
  const collapsedPasteSummary = summarizeCliCollapsedPastes(collapsedPastes);

  const recallPreviousHistory = useCallback(() => {
    const result = recallPreviousCliInputHistory(historyState, draftText);
    if (result.text === undefined) {
      return false;
    }

    setHistoryState(result.state);
    setCollapsedPastes([]);
    setComposer(replaceComposerText(result.text));
    setComposerActivityVersion((version) => version + 1);
    return true;
  }, [draftText, historyState]);

  const recallNextHistory = useCallback(() => {
    const result = recallNextCliInputHistory(historyState);
    if (result.text === undefined) {
      return false;
    }

    setHistoryState(result.state);
    setCollapsedPastes([]);
    setComposer(replaceComposerText(result.text));
    setComposerActivityVersion((version) => version + 1);
    return true;
  }, [historyState]);

  const resetComposer = useCallback(() => {
    setComposer(createComposerState());
    setCollapsedPastes([]);
    setHistoryState((current) => clearCliInputHistoryBrowse(current));
    preferredVerticalColumnRef.current = undefined;
    setComposerActivityVersion((current) => current + 1);
  }, []);

  return {
    composer,
    draftText,
    hasDraftContent: draftText.trim().length > 0,
    collapsedPasteSummary,
    composerActivityVersion,
    insertText,
    replaceText,
    insertNewline,
    backspace,
    moveCursorLeft,
    moveCursorRight,
    moveCursorUp,
    moveCursorDown,
    moveCursorHome,
    moveCursorEnd,
    isBrowsingHistory: historyState.browsingIndex !== undefined,
    recordHistoryEntry,
    recallPreviousHistory,
    recallNextHistory,
    resetComposer,
  };
}
