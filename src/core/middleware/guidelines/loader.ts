import {discoverGuidelineFiles} from '@core/middleware/guidelines/discovery';
import {formatGuidelines} from '@core/middleware/guidelines/format';
import type {GuidelinesOptions, LoadedGuidelines} from '@core/middleware/guidelines/types';
import {loadWorkspaceFiles} from '@core/workspace';

const DEFAULT_MAX_LINES = 500;

/**
 * 加载并拼接当前环境中的 AGENTS.md 规范。
 *
 * 渐进披露策略（对齐 Claude Code）：
 * - 默认截断到 500 行
 * - 简洁提示文件路径，Agent 自己知道如何查看完整内容
 */
export async function loadGuidelines(options: GuidelinesOptions = {}): Promise<LoadedGuidelines | undefined> {
  const files = await loadWorkspaceFiles(discoverGuidelineFiles(options));

  if (files.length === 0) {
    return undefined;
  }

  const formatted = formatGuidelines(files);
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const lines = formatted.split('\n');

  if (lines.length <= maxLines) {
    return {
      files,
      content: formatted,
    };
  }

  // 截断并添加简洁提示（对齐 Claude Code 风格）
  const truncated = lines.slice(0, maxLines).join('\n');
  const truncatedCount = lines.length - maxLines;

  const message = options.truncateMessage ??
    `\n\n[... ${truncatedCount} lines truncated]`;

  return {
    files,
    content: truncated + message,
    truncated: true,
    totalLines: lines.length,
  };
}
