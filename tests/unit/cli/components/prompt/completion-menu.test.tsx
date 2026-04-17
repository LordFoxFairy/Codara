import {describe, expect, it} from 'bun:test';
import {
  calculateCompletionLayout,
  truncateWithEllipsis,
} from '@/cli/features/composer/completion-menu';

describe('completion menu layout helpers', () => {
  it('truncates long content with three ASCII dots', () => {
    expect(truncateWithEllipsis('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcdefg...');
  });

  it('keeps short content unchanged', () => {
    expect(truncateWithEllipsis('/help', 12)).toBe('/help');
  });

  it('reserves a separate description column with fixed gap', () => {
    const layout = calculateCompletionLayout(100);

    expect(layout.nameColumnWidth).toBeGreaterThanOrEqual(18);
    expect(layout.descriptionColumnWidth).toBeGreaterThanOrEqual(20);
    expect(layout.gapWidth).toBe(2);
    expect(layout.nameColumnWidth + layout.descriptionColumnWidth + layout.gapWidth)
      .toBeLessThanOrEqual(layout.contentWidth);
  });

  it('shrinks columns safely on narrow terminals without producing negative widths', () => {
    const layout = calculateCompletionLayout(48);

    expect(layout.nameColumnWidth).toBeGreaterThan(0);
    expect(layout.descriptionColumnWidth).toBeGreaterThan(0);
    expect(layout.nameColumnWidth + layout.descriptionColumnWidth + layout.gapWidth)
      .toBeLessThanOrEqual(layout.contentWidth);
  });
});
