import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import {AIMessage, HumanMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {AgentResult} from '@shared/contracts/agent-types';
import {resolveWorkspaceRoot, type WorkspaceRootOptions} from '@config/workspace';
import {createWorkspaceKey, sanitizeSlug} from '@config/workspace-key';
import {resolveAutoMemoryGlobal} from '@config/settings';
import {evictMemoryFiles} from '@context/memory/eviction';

const MEMORY_INDEX_FILE = 'MEMORY.md';
const TOPICS_DIR = 'topics';
const MEMORY_INDEX_LINE_LIMIT = 200;
const MAX_IMPORTANT_TEXT = 4000;

export interface AutoMemorySource {
  getContent(): Promise<string | undefined>;
  reload(): void;
}

export interface AutoMemoryRuntimeOptions extends WorkspaceRootOptions {
  userHome?: string;
  autoGlobal?: boolean;
  rootDir?: string;
}

export interface AutoMemoryRuntime {
  rootDir: string;
  source: AutoMemorySource;
  recordTurn(input: AutoMemoryTurnInput): Promise<boolean>;
}

export interface AutoMemoryTurnInput {
  previousMessages: readonly BaseMessage[];
  nextMessages: readonly BaseMessage[];
  sessionId: string;
}

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

interface AutoMemoryTopicRecord {
  slug: string;
  name: string;
  description: string;
  type: MemoryType;
  body: string;
  fingerprint: string;
  area: string;
  toolNames: string[];
  touchedPaths: string[];
  createdAt: string;
  updatedAt: string;
}

export function createAutoMemoryRuntime(options: AutoMemoryRuntimeOptions): AutoMemoryRuntime {
  const rootDir = path.resolve(options.rootDir ?? resolveAutoMemoryRoot(options));
  const source = new FileAutoMemorySource(rootDir);

  return {
    rootDir,
    source,
    async recordTurn(input) {
      const entry = buildAutoMemoryTopic(input);
      if (!entry) {
        return false;
      }

      await upsertAutoMemoryTopic(rootDir, entry);
      await rewriteMemoryIndex(rootDir);
      await evictMemoryFiles(path.join(rootDir, TOPICS_DIR)).catch(() => {});
      source.reload();
      return true;
    },
  };
}

export function shouldRecordAutoMemoryTurn(result: Pick<AgentResult, 'reason' | 'state'>): boolean {
  return result.reason === 'complete' && result.state.agentType === 'main' && !result.state.pendingPause;
}

export function resolveAutoMemoryRoot(options: AutoMemoryRuntimeOptions): string {
  const projectRoot = resolveWorkspaceRoot({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
  });
  const userHome = path.resolve(options.userHome ?? homedir());
  const autoGlobal = typeof options.autoGlobal === 'boolean'
    ? options.autoGlobal
    : resolveAutoMemoryGlobal({
        cwd: options.cwd,
        projectRoot: options.projectRoot,
        userHome,
      });

  if (!autoGlobal) {
    return path.join(projectRoot, '.codara', 'memory');
  }

  return path.join(userHome, '.codara', 'projects', createWorkspaceKey(projectRoot), 'memory');
}

class FileAutoMemorySource implements AutoMemorySource {
  private loaded = false;
  private cachedContent?: string;

  constructor(private readonly rootDir: string) {}

  async getContent(): Promise<string | undefined> {
    if (this.loaded) {
      return this.cachedContent;
    }

    const filePath = path.join(this.rootDir, MEMORY_INDEX_FILE);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch {
      this.loaded = true;
      this.cachedContent = undefined;
      return undefined;
    }

    const trimmed = raw.trim();
    if (!trimmed) {
      this.loaded = true;
      this.cachedContent = undefined;
      return undefined;
    }

    const lines = trimmed.split('\n');
    const truncated = lines.length > MEMORY_INDEX_LINE_LIMIT;
    const content = truncated
      ? `${lines.slice(0, MEMORY_INDEX_LINE_LIMIT).join('\n')}\n\nTruncated after ${MEMORY_INDEX_LINE_LIMIT} lines. Read topic files directly for full detail.`
      : trimmed;

    this.cachedContent = content;
    this.loaded = true;
    return content;
  }

  reload(): void {
    this.loaded = false;
    this.cachedContent = undefined;
  }
}

async function upsertAutoMemoryTopic(rootDir: string, next: AutoMemoryTopicRecord): Promise<void> {
  const topicsDir = path.join(rootDir, TOPICS_DIR);
  await mkdir(topicsDir, {recursive: true});
  const filePath = await resolveTopicPath(topicsDir, next);
  const existing = await readAutoMemoryTopic(filePath);

  const topic: AutoMemoryTopicRecord = {
    ...next,
    slug: existing?.slug ?? next.slug,
    name: next.name,
    description: next.description,
    type: next.type,
    body: mergeTopicBodies(existing?.body, next.body),
    fingerprint: existing?.fingerprint ?? next.fingerprint,
    area: existing?.area ?? next.area,
    toolNames: unique([...(existing?.toolNames ?? []), ...next.toolNames]),
    touchedPaths: unique([...(existing?.touchedPaths ?? []), ...next.touchedPaths]),
    createdAt: existing?.createdAt ?? next.createdAt,
  };

  await writeFile(filePath, formatAutoMemoryTopic(topic), 'utf8');
}

async function rewriteMemoryIndex(rootDir: string): Promise<void> {
  const topicsDir = path.join(rootDir, TOPICS_DIR);
  await mkdir(topicsDir, {recursive: true});
  let names: string[];
  try {
    names = await readdir(topicsDir);
  } catch {
    names = [];
  }
  const topics = (
    await Promise.all(
      names
        .filter((name) => name.endsWith('.md'))
        .map((name) => readAutoMemoryTopic(path.join(topicsDir, name))),
    )
  )
    .filter((topic): topic is AutoMemoryTopicRecord => Boolean(topic))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const lines = [
    '# Codara 项目记忆',
    '',
    ...renderMemoryByType(topics),
  ];

  await writeFile(path.join(rootDir, MEMORY_INDEX_FILE), `${lines.join('\n')}\n`, 'utf8');
}

async function readAutoMemoryTopic(filePath: string): Promise<AutoMemoryTopicRecord | undefined> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }

  const parsed = parseFrontmatterDocument(raw);
  if (!parsed) {
    return undefined;
  }

  const frontmatter = parsed.frontmatter;
  const slug = readString(frontmatter.slug) ?? normalizeSlug(path.basename(filePath, '.md'));
  // Support both new (name/description/type) and old (title/summary) formats
  const name = readString(frontmatter.name) ?? readString(frontmatter.title);
  const description = readString(frontmatter.description) ?? readString(frontmatter.summary);
  const type = readMemoryType(frontmatter.type) ?? 'project';
  const fingerprint = readString(frontmatter.fingerprint) ?? normalizeSlug(path.basename(filePath, '.md'));
  const area = readString(frontmatter.area) ?? 'general';
  const toolNames = readStringList(frontmatter.tool_names) ?? [];
  const touchedPaths = readStringList(frontmatter.touched_paths) ?? [];
  const createdAt = readString(frontmatter.created_at) ?? readString(frontmatter.createdAt);
  const updatedAt = readString(frontmatter.updated_at) ?? readString(frontmatter.updatedAt);
  if (!name || !description || !createdAt || !updatedAt) {
    return undefined;
  }

  return {
    slug,
    name,
    description,
    type,
    body: parsed.body.trim(),
    fingerprint,
    area,
    toolNames,
    touchedPaths,
    createdAt,
    updatedAt,
  };
}

function formatAutoMemoryTopic(topic: AutoMemoryTopicRecord): string {
  const frontmatter = yaml.stringify({
    name: topic.name,
    description: topic.description,
    type: topic.type,
    fingerprint: topic.fingerprint,
    area: topic.area,
    tool_names: topic.toolNames,
    touched_paths: topic.touchedPaths,
    created_at: topic.createdAt,
    updated_at: topic.updatedAt,
  }).trimEnd();

  return [
    '---',
    frontmatter,
    '---',
    '',
    topic.body.trim(),
    '',
  ].join('\n');
}

function buildAutoMemoryTopic(input: AutoMemoryTurnInput): AutoMemoryTopicRecord | undefined {
  const addedMessages = input.nextMessages.slice(input.previousMessages.length);
  if (addedMessages.length === 0) {
    return undefined;
  }

  const prompt = addedMessages
    .filter((message) => HumanMessage.isInstance(message))
    .map((message) => normalizeMessageText(message.text))
    .filter(Boolean)
    .at(-1);

  const assistantText = addedMessages
    .filter((message) => AIMessage.isInstance(message))
    .map((message) => normalizeAssistantMemoryText(message.text))
    .filter(Boolean)
    .join('\n\n')
    .trim();

  const toolCalls = addedMessages
    .filter((message) => AIMessage.isInstance(message))
    .flatMap((message) => message.tool_calls ?? []);
  const toolNames = unique(toolCalls.map((call) => call.name).filter(Boolean));
  const touchedPaths = unique(toolCalls.flatMap(collectToolPaths));

  if (!shouldPersistAutoMemory(prompt, assistantText, toolNames, touchedPaths)) {
    return undefined;
  }

  const timestamp = new Date().toISOString();
  const name = deriveTopicTitle(prompt, assistantText, touchedPaths);
  const slug = normalizeSlug(name);
  const description = deriveTopicSummary(prompt, assistantText, toolNames, touchedPaths);
  const type = inferMemoryType(prompt, assistantText);
  const area = deriveTopicArea(touchedPaths);
  const fingerprint = deriveTopicFingerprint(prompt, assistantText, toolNames, touchedPaths, area);
  const body = [
    ...(prompt ? ['## Prompt', prompt, ''] : []),
    ...(assistantText ? ['## Outcome', assistantText, ''] : []),
    ...(toolNames.length > 0 ? ['## Tool Activity', ...toolNames.map((n) => `- ${n}`), ''] : []),
    ...(touchedPaths.length > 0 ? ['## Touched Paths', ...touchedPaths.map((entry) => `- ${entry}`), ''] : []),
    `Recorded for session \`${input.sessionId}\` at ${timestamp}.`,
  ].join('\n').trim();

  return {
    slug,
    name,
    description,
    type,
    body,
    fingerprint,
    area,
    toolNames,
    touchedPaths,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function shouldPersistAutoMemory(
  prompt: string | undefined,
  assistantText: string,
  toolNames: string[],
  touchedPaths: string[],
): boolean {
  const meaningfulPrompt = prompt?.trim();
  const meaningfulAssistant = assistantText.trim();
  if (!meaningfulPrompt && !meaningfulAssistant && toolNames.length === 0) {
    return false;
  }

  if (meaningfulPrompt && /^(hi|hello|hey|thanks|thank you|ok|okay|test)\b/i.test(meaningfulPrompt) && !meaningfulAssistant && toolNames.length === 0) {
    return false;
  }

  if (toolNames.length > 0 || touchedPaths.length > 0) {
    return true;
  }

  if (!meaningfulAssistant || isLowSignalAssistantReply(meaningfulAssistant)) {
    return false;
  }

  return meaningfulAssistant.length >= 48 || (Boolean(meaningfulPrompt) && meaningfulAssistant.length >= 24);
}

function deriveTopicTitle(prompt: string | undefined, assistantText: string, touchedPaths: string[]): string {
  const area = deriveTopicArea(touchedPaths);
  if (area !== 'general') {
    return area.includes('/') ? `Work in ${area}` : `Work on ${area}`;
  }

  const promptTitle = clampSentence(prompt);
  if (promptTitle) {
    return promptTitle;
  }

  return clampSentence(assistantText) ?? 'Session learning';
}

function deriveTopicSummary(
  prompt: string | undefined,
  assistantText: string,
  toolNames: string[],
  touchedPaths: string[],
): string {
  const candidate = normalizeMessageText(assistantText) || normalizeMessageText(prompt ?? '');
  if (candidate) {
    return clampText(candidate, 160);
  }

  if (toolNames.length > 0 || touchedPaths.length > 0) {
    return clampText(`Used ${toolNames.join(', ')} on ${touchedPaths.join(', ')}`, 160);
  }

  return 'Stored learning from a successful turn.';
}

function deriveTopicFingerprint(
  prompt: string | undefined,
  assistantText: string,
  toolNames: string[],
  touchedPaths: string[],
  area: string,
): string {
  const key = [
    area === 'general' ? normalizeFingerprintText(prompt ?? '') : area.toLowerCase(),
    normalizeFingerprintText(deriveTopicTitle(prompt, assistantText, touchedPaths)),
    toolNames.map((name) => name.toLowerCase()).sort().join('|'),
    area === 'general' ? touchedPaths.map((entry) => entry.toLowerCase()).sort().join('|') : '',
  ].join('::');

  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

function deriveTopicArea(touchedPaths: string[]): string {
  if (touchedPaths.length === 0) {
    return 'general';
  }

  const normalized = touchedPaths
    .map((entry) => entry.replace(/\\/g, '/').replace(/\/+$/g, ''))
    .filter(Boolean);
  if (normalized.length === 0) {
    return 'general';
  }

  if (normalized.length === 1) {
    const parent = path.posix.dirname(normalized[0]);
    return parent !== '.' ? parent : normalized[0];
  }

  const prefix = commonPathPrefix(normalized);
  if (prefix) {
    return prefix;
  }

  const parentGroups = unique(
    normalized.map((entry) => {
      const parent = path.posix.dirname(entry);
      return parent === '.' ? entry : parent;
    }),
  );

  return parentGroups.length === 1 ? parentGroups[0] : normalized[0];
}

function collectToolPaths(toolCall: ToolCall): string[] {
  const args = readRecord(toolCall.args);
  return unique([
    readString(args.file_path),
    readString(args.path),
    readString(args.cwd),
  ].filter(Boolean) as string[]);
}

function parseFrontmatterDocument(raw: string): {frontmatter: Record<string, unknown>; body: string} | undefined {
  const match = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:[ \t]*\r?\n|$)([\s\S]*)$/);
  if (!match) {
    return undefined;
  }

  try {
    const parsed = yaml.parse(match[1]);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    return {
      frontmatter: parsed as Record<string, unknown>,
      body: match[2] ?? '',
    };
  } catch {
    return undefined;
  }
}

async function resolveTopicPath(topicsDir: string, next: AutoMemoryTopicRecord): Promise<string> {
  const preferred = path.join(topicsDir, `${next.slug}.md`);
  const existingPreferred = await readAutoMemoryTopic(preferred);
  if (existingPreferred?.fingerprint === next.fingerprint || !existsSync(preferred)) {
    return preferred;
  }

  let names: string[];
  try {
    names = await readdir(topicsDir);
  } catch {
    names = [];
  }
  for (const name of names) {
    if (!name.endsWith('.md')) {
      continue;
    }

    const candidate = await readAutoMemoryTopic(path.join(topicsDir, name));
    if (candidate?.fingerprint === next.fingerprint) {
      return path.join(topicsDir, name);
    }
  }

  return preferred;
}

const MEMORY_TYPE_ORDER: MemoryType[] = ['user', 'feedback', 'project', 'reference'];
const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  user: 'User',
  feedback: 'Feedback',
  project: 'Project',
  reference: 'Reference',
};

function renderMemoryByType(topics: AutoMemoryTopicRecord[]): string[] {
  if (topics.length === 0) {
    return ['No stored memories yet.'];
  }

  const grouped = new Map<MemoryType, AutoMemoryTopicRecord[]>();
  for (const topic of topics) {
    const list = grouped.get(topic.type) ?? [];
    list.push(topic);
    grouped.set(topic.type, list);
  }

  const lines: string[] = [];
  for (const type of MEMORY_TYPE_ORDER) {
    const group = grouped.get(type);
    if (!group || group.length === 0) {
      continue;
    }

    lines.push(`## ${MEMORY_TYPE_LABELS[type]}`);
    for (const topic of group) {
      lines.push(`- [${topic.name}](topics/${topic.slug}.md) — ${topic.description}`);
    }
    lines.push('');
  }

  return lines;
}

function inferMemoryType(prompt: string | undefined, assistantText: string): MemoryType {
  const combined = `${prompt ?? ''} ${assistantText}`.toLowerCase();

  if (/\b(don'?t|stop|instead|no not|不要|改为|应该|别|rather than)\b/.test(combined)) {
    return 'feedback';
  }

  if (/\b(i am|i'm|i prefer|i usually|my role|我是|我偏好|我习惯)\b/.test(combined)) {
    return 'user';
  }

  if (/\b(https?:\/\/|linear|jira|slack|grafana|confluence|notion)\b/.test(combined)) {
    return 'reference';
  }

  return 'project';
}

function readMemoryType(value: unknown): MemoryType | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (MEMORY_TYPE_ORDER.includes(normalized as MemoryType)) {
    return normalized as MemoryType;
  }

  return undefined;
}

function mergeTopicBodies(existing: string | undefined, next: string): string {
  const trimmedNext = next.trim();
  if (!existing?.trim()) {
    return trimmedNext;
  }

  const trimmedExisting = existing.trim();
  if (trimmedExisting === trimmedNext || trimmedExisting.includes(trimmedNext)) {
    return trimmedExisting;
  }

  return [
    trimmedNext,
    '',
    '## Earlier Notes',
    '',
    clampText(trimmedExisting, 2500),
  ].join('\n');
}

function normalizeAssistantMemoryText(value: string): string {
  const trimmed = normalizeMessageText(value);
  if (!trimmed || trimmed.startsWith('Summary:\n')) {
    return '';
  }
  return trimmed;
}

function isLowSignalAssistantReply(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return /^(done|completed|fixed|updated|noted|ok|okay|thanks|thank you|saved)\.?$/i.test(normalized);
}

function normalizeFingerprintText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[`'"“”‘’]/g, '');
}

function normalizeMessageText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.length > MAX_IMPORTANT_TEXT ? `${trimmed.slice(0, MAX_IMPORTANT_TEXT)}…` : trimmed;
}

function clampSentence(value: string | undefined, limit = 80): string | undefined {
  const normalized = normalizeMessageText(value ?? '');
  if (!normalized) {
    return undefined;
  }

  const sentence = normalized
    .replace(/\s+/g, ' ')
    .replace(/^[-*]\s*/, '')
    .trim();
  return clampText(sentence, limit);
}

function clampText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

function normalizeSlug(value: string): string {
  const normalized = sanitizeSlug(value);
  return normalized || 'session-learning';
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => Boolean(entry));
  return normalized.length > 0 ? normalized : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function commonPathPrefix(entries: string[]): string | undefined {
  if (entries.length < 2) {
    return undefined;
  }

  const segments = entries.map((entry) => entry.split('/').filter(Boolean));
  const prefix: string[] = [];
  for (let index = 0; index < segments[0].length; index += 1) {
    const candidate = segments[0][index];
    if (!segments.every((parts) => parts[index] === candidate)) {
      break;
    }
    prefix.push(candidate);
  }

  return prefix.length > 0 ? prefix.join('/') : undefined;
}
