import type {CliComposerState} from './types';

const COLLAPSED_PASTE_CHAR_THRESHOLD = 80;

export interface CliCollapsedPaste {
  text: string;
  charCount: number;
  lineCount: number;
}

export interface CliCollapsedPasteSummary {
  blockCount: number;
  charCount: number;
  lineCount: number;
}

function countPasteLines(text: string): number {
  if (!text) {
    return 0;
  }

  return text.split('\n').length;
}

export function shouldCollapseCliPaste(input: string, composer: CliComposerState): boolean {
  if (composer.text.length > 0 || composer.cursorOffset !== 0) {
    return false;
  }

  return input.includes('\n') || input.length >= COLLAPSED_PASTE_CHAR_THRESHOLD;
}

export function createCliCollapsedPaste(text: string): CliCollapsedPaste {
  return {
    text,
    charCount: text.length,
    lineCount: countPasteLines(text),
  };
}

export function summarizeCliCollapsedPastes(
  pastes: readonly CliCollapsedPaste[],
): CliCollapsedPasteSummary | undefined {
  if (pastes.length === 0) {
    return undefined;
  }

  return {
    blockCount: pastes.length,
    charCount: pastes.reduce((total, paste) => total + paste.charCount, 0),
    lineCount: pastes.reduce((total, paste) => total + paste.lineCount, 0),
  };
}

export function composeCliDraftText(typedText: string, pastes: readonly CliCollapsedPaste[]): string {
  return `${pastes.map((paste) => paste.text).join('')}${typedText}`;
}
