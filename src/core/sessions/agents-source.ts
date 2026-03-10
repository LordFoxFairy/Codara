import type {WorkspaceFileOptions} from '@core/workspace';
import {loadGuidelines, type GuidelinesOptions} from '@core/sessions/agents-content';

/**
 * AGENTS source 生命周期接口。
 * 负责读取 AGENTS.md 投影，并支持显式 reload。
 */
export interface AgentsSource {
  /** 读取当前 session 可见的 AGENTS.md 投影。 */
  getContent(): Promise<string | undefined>;

  /** 使当前缓存失效，下一次读取时重新加载。 */
  reload(): void;
}

interface CacheEntry {
  content?: string;
  timestamp: number;
}

interface AgentsContentLoader {
  load: () => Promise<string | undefined>;
}

export interface FileAgentsSourceOptions {
  load: AgentsContentLoader['load'];
  cacheTTL?: number;
}

/**
 * 基于文件系统的 AGENTS source。
 * 支持 TTL 缓存和手动失效。
 */
export class FileAgentsSource implements AgentsSource {
  private readonly load: AgentsContentLoader['load'];
  private readonly cacheTTL?: number;
  private cache?: CacheEntry;

  constructor(options: FileAgentsSourceOptions) {
    this.load = options.load;
    this.cacheTTL = typeof options.cacheTTL === 'number' ? options.cacheTTL : undefined;
  }

  async getContent(): Promise<string | undefined> {
    const cached = this.cache;
    const now = Date.now();

    if (cached && (this.cacheTTL === undefined || now - cached.timestamp < this.cacheTTL)) {
      return cached.content;
    }

    const content = await this.load();
    this.cache = {content, timestamp: now};
    return content;
  }

  reload(): void {
    this.cache = undefined;
  }
}

/**
 * 创建 Codara 默认的 AGENTS source。
 * 默认缓存会在 session 生命周期内保持稳定，只有显式 reload 才会失效。
 */
export interface CodaraAgentsSourceOptions extends WorkspaceFileOptions {
  guidelines?: boolean | GuidelinesOptions;
  cacheTTL?: number;
}

export function createCodaraAgentsSource(options: CodaraAgentsSourceOptions = {}): AgentsSource | undefined {
  if (options.guidelines === false) {
    return undefined;
  }

  return new FileAgentsSource({
    load: async () => {
      const loaded = await loadGuidelines(resolveGuidelinesOptions(options));
      return loaded?.content;
    },
    ...(typeof options.cacheTTL === 'number' ? {cacheTTL: options.cacheTTL} : {}),
  });
}

function resolveGuidelinesOptions(options: CodaraAgentsSourceOptions): GuidelinesOptions {
  const guidelines = isSourceOptionsObject(options.guidelines) ? options.guidelines : undefined;

  return {
    ...(options.cwd ? {cwd: options.cwd} : {}),
    ...(options.projectRoot ? {projectRoot: options.projectRoot} : {}),
    ...(options.userHome ? {userHome: options.userHome} : {}),
    ...(guidelines?.cwd ? {cwd: guidelines.cwd} : {}),
    ...(guidelines?.projectRoot ? {projectRoot: guidelines.projectRoot} : {}),
    ...(guidelines?.userHome ? {userHome: guidelines.userHome} : {}),
    ...(typeof guidelines?.maxLines === 'number' ? {maxLines: guidelines.maxLines} : {}),
  };
}

function isSourceOptionsObject<T extends object>(value: boolean | T | undefined): value is T {
  return Boolean(value && typeof value === 'object');
}
