/**
 * Path safety checks — ported from Claude Code's filesystem.ts.
 *
 * Detects dangerous file paths that should not be auto-edited without
 * explicit user permission. Protects against:
 * - Git config manipulation (code execution via hooks)
 * - Shell startup script modification (persistent backdoors)
 * - IDE configuration changes (VS Code, JetBrains)
 * - Codara's own config files
 */
import path from 'node:path';

/**
 * Dangerous files that should be protected from auto-editing.
 * Can be used for code execution or data exfiltration.
 */
export const DANGEROUS_FILES = [
  '.gitconfig',
  '.gitmodules',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  '.profile',
  '.ripgreprc',
  '.mcp.json',
] as const;

/**
 * Dangerous directories that should be protected from auto-editing.
 * Contain sensitive configuration or executable files.
 */
export const DANGEROUS_DIRECTORIES = [
  '.git',
  '.vscode',
  '.idea',
  '.codara',
] as const;

export interface PathSafetyResult {
  safe: boolean;
  /** Present when safe = false — describes the risk. */
  reason?: string;
}

/**
 * Check if a file path is dangerous to auto-edit without explicit permission.
 *
 * Checks for:
 * - Files in .git directories or .gitconfig files
 * - Files in .vscode / .idea directories
 * - Files in .codara directories (own config)
 * - Shell configuration files (.bashrc, .zshrc, etc.)
 */
export function checkPathSafety(filePath: string): PathSafetyResult {
  const absolutePath = path.resolve(filePath);
  const segments = absolutePath.split(path.sep);
  const fileName = segments.at(-1);

  // Check if path is within dangerous directories (case-insensitive)
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    for (const dir of DANGEROUS_DIRECTORIES) {
      if (lower === dir.toLowerCase()) {
        return {
          safe: false,
          reason: `Path contains protected directory "${dir}": ${filePath}`,
        };
      }
    }
  }

  // Check for dangerous configuration files (case-insensitive)
  if (fileName) {
    const lowerFileName = fileName.toLowerCase();
    for (const dangerousFile of DANGEROUS_FILES) {
      if (lowerFileName === dangerousFile.toLowerCase()) {
        return {
          safe: false,
          reason: `"${fileName}" is a sensitive configuration file: ${filePath}`,
        };
      }
    }
  }

  return {safe: true};
}

/**
 * Check if a path is within a given working directory.
 * Rejects path traversal attempts (../).
 */
export function isPathWithinDirectory(filePath: string, directory: string): boolean {
  const absolutePath = path.resolve(filePath);
  const absoluteDir = path.resolve(directory);
  const relative = path.relative(absoluteDir, absolutePath);

  if (!relative) return true; // same path
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  return true;
}
