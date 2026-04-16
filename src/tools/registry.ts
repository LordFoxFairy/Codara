/**
 * Tool Registry — centralized discovery and metadata for ALL Codara tools.
 *
 * Aligned with Claude Code tools.ts pattern:
 * - Single source of truth for tool registration
 * - Prompt retrieval by tool name
 * - Validation metadata
 * - Tool categorization (builtin, capability, mcp)
 *
 * This registry does NOT own tool construction (that stays in assembly/tools.ts).
 * It owns tool *metadata*: prompts, validation rules, and categorization.
 */

import {getBashToolPrompt} from '@tools/builtin/bash-prompt';
import {getReadToolPrompt} from '@tools/builtin/read-prompt';
import {getEditToolPrompt} from '@tools/builtin/edit-prompt';
import {getWriteToolPrompt} from '@tools/builtin/write-prompt';
import {getGlobToolPrompt} from '@tools/builtin/glob-prompt';
import {getGrepToolPrompt} from '@tools/builtin/grep-prompt';
import {getFetchToolPrompt} from '@tools/builtin/fetch-prompt';
import {getSearchToolPrompt} from '@tools/builtin/search-prompt';
import {getAskUserToolPrompt} from '@tools/ask-user/prompt';

// ── Types ──

export type ToolCategory = 'builtin' | 'capability' | 'mcp' | 'skill';

export interface ToolRegistryEntry {
  /** Canonical tool name. */
  name: string;
  /** Tool category for filtering and display. */
  category: ToolCategory;
  /** System prompt function — returns context-sensitive instructions. */
  getPrompt: () => string;
  /** Input validation rules beyond schema (e.g., path security, command safety). */
  validateInput?: (input: Record<string, unknown>) => ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

// ── Registry ──

export interface ToolRegistry {
  register(entry: ToolRegistryEntry): void;
  get(name: string): ToolRegistryEntry | undefined;
  getPrompt(name: string): string | undefined;
  getAll(): ReadonlyMap<string, ToolRegistryEntry>;
  getByCategory(category: ToolCategory): ToolRegistryEntry[];
}

export function createToolRegistry(): ToolRegistry {
  const entries = new Map<string, ToolRegistryEntry>();
  return {
    register(entry) { entries.set(entry.name, entry); },
    get(name) { return entries.get(name); },
    getPrompt(name) { return entries.get(name)?.getPrompt(); },
    getAll() { return entries; },
    getByCategory(category) { return [...entries.values()].filter((e) => e.category === category); },
  };
}

// ── Default registry (module-level, pre-populated with builtins) ──

const defaultRegistry = createToolRegistry();

export function registerTool(entry: ToolRegistryEntry): void {
  defaultRegistry.register(entry);
}

export function getToolEntry(name: string): ToolRegistryEntry | undefined {
  return defaultRegistry.get(name);
}

export function getToolPrompt(name: string): string | undefined {
  return defaultRegistry.getPrompt(name);
}

export function getAllToolEntries(): ReadonlyMap<string, ToolRegistryEntry> {
  return defaultRegistry.getAll();
}

export function getToolsByCategory(category: ToolCategory): ToolRegistryEntry[] {
  return defaultRegistry.getByCategory(category);
}

// ── Builtin tool validation helpers ──

function validatePathInput(input: Record<string, unknown>): ValidationResult {
  const filePath = input.file_path ?? input.path;
  if (typeof filePath === 'string') {
    if (!filePath.startsWith('/') && filePath !== '') {
      return {valid: false, message: 'file_path must be absolute'};
    }
    if (filePath.includes('\0')) {
      return {valid: false, message: 'path contains null bytes'};
    }
    if (filePath.includes('..')) {
      return {valid: false, message: 'path contains traversal sequences'};
    }
    if (filePath.length > 4096) {
      return {valid: false, message: 'path exceeds 4096 characters'};
    }
  }
  return {valid: true};
}

function validateBashInput(input: Record<string, unknown>): ValidationResult {
  const command = input.command;
  if (typeof command !== 'string' || command.trim().length === 0) {
    return {valid: false, message: 'command must be a non-empty string'};
  }
  return {valid: true};
}

function validateGrepInput(input: Record<string, unknown>): ValidationResult {
  const pattern = input.pattern;
  if (typeof pattern !== 'string' || pattern.trim().length === 0) {
    return {valid: false, message: 'pattern must be a non-empty string'};
  }
  // Validate regex syntax
  try {
    new RegExp(pattern);
  } catch {
    return {valid: false, message: `invalid regex pattern: ${pattern}`};
  }
  return {valid: true};
}

function validateUrlInput(input: Record<string, unknown>): ValidationResult {
  const url = input.url;
  if (typeof url !== 'string' || url.trim().length === 0) {
    return {valid: false, message: 'url must be a non-empty string'};
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {valid: false, message: 'only HTTP/HTTPS protocols are supported'};
    }
  } catch {
    return {valid: false, message: `invalid URL: ${url}`};
  }
  return {valid: true};
}

// ── Builtin registrations ──

registerTool({
  name: 'bash',
  category: 'builtin',
  getPrompt: getBashToolPrompt,
  validateInput: validateBashInput,
});

registerTool({
  name: 'read_file',
  category: 'builtin',
  getPrompt: getReadToolPrompt,
  validateInput: validatePathInput,
});

registerTool({
  name: 'edit_file',
  category: 'builtin',
  getPrompt: getEditToolPrompt,
  validateInput: validatePathInput,
});

registerTool({
  name: 'write_file',
  category: 'builtin',
  getPrompt: getWriteToolPrompt,
  validateInput: validatePathInput,
});

registerTool({
  name: 'glob',
  category: 'builtin',
  getPrompt: getGlobToolPrompt,
});

registerTool({
  name: 'grep',
  category: 'builtin',
  getPrompt: getGrepToolPrompt,
  validateInput: validateGrepInput,
});

registerTool({
  name: 'fetch_url',
  category: 'builtin',
  getPrompt: getFetchToolPrompt,
  validateInput: validateUrlInput,
});

registerTool({
  name: 'web_search',
  category: 'builtin',
  getPrompt: getSearchToolPrompt,
});

// ── Capability tool registrations ──
// These are registered with minimal prompts since their descriptions
// are already comprehensive in their tool definitions.

registerTool({
  name: 'Agent',
  category: 'capability',
  getPrompt: () => 'Launch a specialized subagent to handle a focused sub-problem autonomously.',
});

registerTool({
  name: 'TaskCreate',
  category: 'capability',
  getPrompt: () => 'Create a persistent shared task for cross-agent coordination.',
});

registerTool({
  name: 'TaskUpdate',
  category: 'capability',
  getPrompt: () => 'Update a shared task status, owner, or dependency graph.',
});

registerTool({
  name: 'TaskGet',
  category: 'capability',
  getPrompt: () => 'Get a single task by its ID.',
});

registerTool({
  name: 'TaskList',
  category: 'capability',
  getPrompt: () => 'List all shared tasks with status and dependency information.',
});

registerTool({
  name: 'AskUserQuestion',
  category: 'capability',
  getPrompt: getAskUserToolPrompt,
});

registerTool({
  name: 'MemoryWrite',
  category: 'capability',
  getPrompt: () => 'Persist a memory for future sessions. Use for saving important context, decisions, user preferences, feedback, or reference material.',
});

registerTool({
  name: 'MemoryRead',
  category: 'capability',
  getPrompt: () => 'Read a specific memory by name. Use MemoryList first to discover available memory names.',
});

registerTool({
  name: 'MemoryList',
  category: 'capability',
  getPrompt: () => 'List all stored memories or search by keyword.',
});

registerTool({
  name: 'Skill',
  category: 'skill',
  getPrompt: () => 'Execute a skill within the main conversation. Skills provide specialized capabilities and domain knowledge.',
});

registerTool({
  name: 'notebook_read',
  category: 'builtin',
  getPrompt: () => 'Reads and parses Jupyter notebook (.ipynb) files into human-readable text with code cells, outputs, and markdown.',
});

registerTool({
  name: 'enter_worktree',
  category: 'builtin',
  getPrompt: () => 'Creates a git worktree for isolated parallel work. Use when an agent needs its own working directory.',
});

registerTool({
  name: 'exit_worktree',
  category: 'builtin',
  getPrompt: () => 'Removes a git worktree and cleans up its directory when parallel work is complete.',
});

registerTool({
  name: 'list_worktrees',
  category: 'builtin',
  getPrompt: () => 'Lists all git worktrees in the current repository with path, HEAD, and branch info.',
});
