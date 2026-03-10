import type {WorkspaceFileOptions} from '@core/workspace';
import {loadGuidelines, type GuidelinesOptions} from '@core/middleware/guidelines';

/**
 * Source provider 接口。
 * 负责按需读取 source 内容（如 AGENTS.md），支持缓存和失效。
 */
export interface SourceProvider {
  /** 读取指定 key 的内容。返回 undefined 表示不存在。 */
  get(key: string): Promise<string | undefined>;

  /** 使指定 key 的缓存失效。 */
  invalidate(key: string): void;

  /** 使所有缓存失效。 */
  invalidateAll(): void;
}

interface CacheEntry {
  content?: string;
  timestamp: number;
}

interface SourceLoaderConfig {
  load: () => Promise<string | undefined>;
}

export interface FileSourceProviderOptions {
  sources: Record<string, SourceLoaderConfig>;
  cacheTTL?: number;
}

/**
 * 基于文件系统的 source provider。
 * 支持 TTL 缓存和手动失效。
 */
export class FileSourceProvider implements SourceProvider {
  private readonly sources: Record<string, SourceLoaderConfig>;
  private readonly cacheTTL?: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: FileSourceProviderOptions) {
    this.sources = options.sources;
    this.cacheTTL = typeof options.cacheTTL === 'number' ? options.cacheTTL : undefined;
  }

  async get(key: string): Promise<string | undefined> {
    const config = this.sources[key];
    if (!config) {
      return undefined;
    }

    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && (this.cacheTTL === undefined || now - cached.timestamp < this.cacheTTL)) {
      return cached.content;
    }

    const content = await config.load();
    this.cache.set(key, {content, timestamp: now});
    return content;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}

/**
 * 创建 Codara 默认的 source provider。
 * 默认缓存会在 session 生命周期内保持稳定，只有显式 reload 才会失效。
 */
export interface CodaraSourceProviderOptions extends WorkspaceFileOptions {
  guidelines?: boolean | GuidelinesOptions;
  cacheTTL?: number;
}

export function createCodaraSourceProvider(options: CodaraSourceProviderOptions = {}): SourceProvider {
  const sources: Record<string, SourceLoaderConfig> = {};

  if (options.guidelines !== false) {
    sources.guidelines = {
      load: async () => {
        const loaded = await loadGuidelines(resolveGuidelinesOptions(options));
        return loaded?.content;
      },
    };
  }

  return new FileSourceProvider({
    sources,
    ...(typeof options.cacheTTL === 'number' ? {cacheTTL: options.cacheTTL} : {}),
  });
}

function resolveGuidelinesOptions(options: CodaraSourceProviderOptions): GuidelinesOptions {
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
