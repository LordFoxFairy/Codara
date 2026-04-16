/**
 * Terminal layout mode resolution.
 *
 * Maps the current terminal width to one of three layout tiers that
 * components use to decide how much detail to render.
 */
export type CliLayoutMode = 'wide' | 'compact' | 'minimal';

export const WIDE_LAYOUT_MIN_WIDTH = 90;
export const COMPACT_LAYOUT_MIN_WIDTH = 60;

export function resolveCliLayoutMode(terminalWidth: number): CliLayoutMode {
  if (terminalWidth >= WIDE_LAYOUT_MIN_WIDTH) {
    return 'wide';
  }

  if (terminalWidth >= COMPACT_LAYOUT_MIN_WIDTH) {
    return 'compact';
  }

  return 'minimal';
}
