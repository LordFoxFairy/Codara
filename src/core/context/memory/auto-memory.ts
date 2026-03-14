import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import {AIMessage, HumanMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {AgentResult} from '@core/agents/models/agent';
import {resolveWorkspaceRoot, type WorkspaceRootOptions} from '@core/config/workspace';
import {resolveAutoMemoryGlobal} from '@core/config/settings';

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

interface AutoMemoryTopicRecord {
  slug: string;
  title: string;
  summary: string;
  body: string;
  fingerprint: string;
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
    body: mergeTopicBodies(existing?.body, next.body),
    fingerprint: existing?.fingerprint ?? next.fingerprint,
    toolNames: unique([...(existing?.toolNames ?? []), ...next.toolNames]),
    touchedPaths: unique([...(existing?.touchedPaths ?? []), ...next.touchedPaths]),
    createdAt: existing?.createdAt ?? next.createdAt,
  };

  await writeFile(filePath, formatAutoMemoryTopic(topic), 'utf8');
}

async function rewriteMemoryIndex(rootDir: string): Promise<void> {
  const topicsDir = path.join(rootDir, TOPICS_DIR);
  await mkdir(topicsDir, {recursive: true});
  const names = existsSync(topicsDir) ? await readdir(topicsDir) : [];
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
    '# Auto Memory',
    '',
    'Loaded from the Codara auto memory index for this workspace.',
    'Detailed notes live under `topics/` and can be read directly when needed.',
    '',
    '## Recent Topics',
    ...(topics.length > 0
      ? topics.flatMap((topic) => {
        const meta = [
          `Updated ${topic.updatedAt.slice(0, 10)}`,
          ...(topic.toolNames.length > 0 ? [`Tools: ${topic.toolNames.join(', ')}`] : []),
          ...(topic.touchedPaths.length > 0 ? [`Paths: ${topic.touchedPaths.slice(0, 2).join(', ')}`] : []),
        ];
        return [
          `- [${topic.title}](topics/${topic.slug}.md): ${topic.summary}`,
          `  ${meta.join(' · ')}`,
        ];
      })
      : ['- No stored memories yet.']),
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
  const title = readString(frontmatter.title);
  const summary = readString(frontmatter.summary);
  const fingerprint = readString(frontmatter.fingerprint) ?? normalizeSlug(path.basename(filePath, '.md'));
  const toolNames = readStringList(frontmatter.tool_names) ?? [];
  const touchedPaths = readStringList(frontmatter.touched_paths) ?? [];
  const createdAt = readString(frontmatter.created_at) ?? readString(frontmatter.createdAt);
  const updatedAt = readString(frontmatter.updated_at) ?? readString(frontmatter.updatedAt);
  if (!title || !summary || !createdAt || !updatedAt) {
    return undefined;
  }

  return {
    slug,
    title,
    summary,
    body: parsed.body.trim(),
    fingerprint,
    toolNames,
    touchedPaths,
    createdAt,
    updatedAt,
  };
}

function formatAutoMemoryTopic(topic: AutoMemoryTopicRecord): string {
  const frontmatter = yaml.stringify({
    slug: topic.slug,
    title: topic.title,
    summary: topic.summary,
    fingerprint: topic.fingerprint,
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
    `# ${topic.title}`,
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
  const title = deriveTopicTitle(prompt, assistantText, touchedPaths);
  const slug = normalizeSlug(title);
  const summary = deriveTopicSummary(prompt, assistantText, toolNames, touchedPaths);
  const fingerprint = deriveTopicFingerprint(prompt, assistantText, toolNames, touchedPaths);
  const body = [
    ...(prompt ? ['## Prompt', prompt, ''] : []),
    ...(assistantText ? ['## Outcome', assistantText, ''] : []),
    ...(toolNames.length > 0 ? ['## Tool Activity', ...toolNames.map((name) => `- ${name}`), ''] : []),
    ...(touchedPaths.length > 0 ? ['## Touched Paths', ...touchedPaths.map((entry) => `- ${entry}`), ''] : []),
    `Recorded for session \`${input.sessionId}\` at ${timestamp}.`,
  ].join('\n').trim();

  return {
    slug,
    title,
    summary,
    body,
    fingerprint,
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
  const promptTitle = clampSentence(prompt);
  if (promptTitle) {
    return promptTitle;
  }

  if (touchedPaths.length > 0) {
    return `Work on ${path.basename(touchedPaths[0])}`;
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
): string {
  const key = [
    normalizeFingerprintText(prompt ?? ''),
    normalizeFingerprintText(deriveTopicTitle(prompt, assistantText, touchedPaths)),
    toolNames.map((name) => name.toLowerCase()).sort().join('|'),
    touchedPaths.map((entry) => entry.toLowerCase()).sort().join('|'),
  ].join('::');

  return createHash('sha1').update(key).digest('hex').slice(0, 16);
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
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
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

  const names = existsSync(topicsDir) ? await readdir(topicsDir) : [];
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

function createWorkspaceKey(projectRoot: string): string {
  const base = sanitizeSlug(path.basename(path.resolve(projectRoot))) || 'workspace';
  const digest = createHash('sha1').update(path.resolve(projectRoot)).digest('hex').slice(0, 12);
  return `${base}-${digest}`;
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

function sanitizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`'"“”‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
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
