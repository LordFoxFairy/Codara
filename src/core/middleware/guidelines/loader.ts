import {homedir} from 'node:os';
import path from 'node:path';
import type {GuidelinesOptions, LoadedGuidelines, GuidelineFile} from '@core/middleware/guidelines/types';
import {loadWorkspaceFiles, resolveWorkspaceRoot} from '@core/workspace';

const DEFAULT_MAX_LINES = 500;

/**
 * 加载 AGENTS.md guidelines
 *
 * 对齐 Claude Code：
 * - 发现文件（~/.codara/AGENTS.md, project/AGENTS.md）
 * - 加载内容，500 行截断保护
 * - 格式化为 "Contents of /path (label):" 格式
 */
export async function loadGuidelines(options: GuidelinesOptions = {}): Promise<LoadedGuidelines | undefined> {
  // 发现文件
  const files = discoverGuidelineFiles(options);

  // 加载文件内容
  const loadedFiles = await loadWorkspaceFiles(files);

  if (loadedFiles.length === 0) {
    return undefined;
  }

  // 格式化内容
  const formatted = formatGuidelines(loadedFiles);

  // 截断保护
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const lines = formatted.split('\n');

  if (lines.length <= maxLines) {
    return {
      files: loadedFiles,
      content: formatted,
    };
  }

  const truncated = lines.slice(0, maxLines).join('\n');
  const truncatedCount = lines.length - maxLines;
  const message = options.truncateMessage ?? `\n\n[... ${truncatedCount} lines truncated]`;

  return {
    files: loadedFiles,
    content: truncated + message,
    truncated: true,
    totalLines: lines.length,
  };
}

/** 发现 guidelines 文件 */
function discoverGuidelineFiles(options: GuidelinesOptions = {}): GuidelineFile[] {
  const userHome = options.userHome ?? homedir();
  const projectRoot = resolveWorkspaceRoot({
    projectRoot: options.projectRoot,
    cwd: options.cwd,
  });

  return [
    {
      scope: 'global',
      path: path.join(userHome, '.codara', 'AGENTS.md'),
    },
    {
      scope: 'project',
      path: path.join(projectRoot, 'AGENTS.md'),
    },
  ];
}

/** 格式化 guidelines 内容 */
function formatGuidelines(
  guidelines: Array<{scope: 'global' | 'project'; path: string; content: string}>
): string {
  if (guidelines.length === 0) {
    return '';
  }

  const sections: string[] = [];

  for (const guideline of guidelines) {
    const label = guideline.scope === 'global'
      ? 'user instructions'
      : 'project instructions, checked into the codebase';

    sections.push(
      `Contents of ${guideline.path} (${label}):`,
      '',
      guideline.content
    );
  }

  return sections.join('\n');
}
