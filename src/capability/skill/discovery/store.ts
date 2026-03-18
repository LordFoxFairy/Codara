import {readdir, readFile, stat} from 'node:fs/promises'
import {homedir} from 'node:os'
import path from 'node:path'
import {MAX_SKILL_FILE_SIZE, parseSkillMetadataFromContent} from '@capability/skill/catalog/loading'
import {skillsMetadataReducer} from '@capability/skill/catalog/metadata'
import type {SkillMetadata, SkillStore} from '@capability/skill/catalog/types'
import {resolveWorkspaceRoot} from '@infra/config/workspace'

const DEFAULT_CACHE_TTL_MS = 5_000
const SKILL_FILE_NAME = 'SKILL.md'

interface SkillCacheEntry {
  expiresAt: number
  skills: SkillMetadata[]
}

/**
 * Filesystem-backed discovery for SkillsMiddleware.
 *
 * Sources are loaded in order, and later sources override earlier ones.
 *
 * **Namespace convention (Codex-style):** If a directory under a source
 * does NOT contain SKILL.md but DOES contain subdirectories with SKILL.md,
 * it is treated as a namespace directory. Skills are named `namespace:skill-name`
 * (e.g. `.codara/skills/superworkers/brainstorming/SKILL.md` → `superworkers:brainstorming`).
 */
export class FileSystemSkillStore implements SkillStore {
  private readonly sources: string[]
  private readonly cacheTtlMs: number
  private cache: SkillCacheEntry | null = null

  constructor(
    options: {sources?: string[]; userHome?: string; projectRoot?: string; cacheTtlMs?: number; claudeSkillsCompat?: boolean} = {}
  ) {
    this.sources = options.sources && options.sources.length > 0
      ? options.sources
      : getDefaultSkillSources({
          userHome: options.userHome,
          projectRoot: options.projectRoot,
          claudeSkillsCompat: options.claudeSkillsCompat,
        })
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  }

  async discover(): Promise<SkillMetadata[]> {
    if (this.cacheTtlMs > 0 && this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.skills
    }

    let mergedSkills: SkillMetadata[] = []

    for (const root of this.sources) {
      const sourceSkills = await discoverSkillsInDirectory(root)
      mergedSkills = skillsMetadataReducer(mergedSkills, sourceSkills)
    }

    const skills = mergedSkills
    if (this.cacheTtlMs > 0) {
      this.cache = {expiresAt: Date.now() + this.cacheTtlMs, skills}
    } else {
      this.cache = null
    }
    return skills
  }

  listSources(): string[] {
    return [...this.sources]
  }

  refresh(): void {
    this.cache = null
  }
}

/**
 * Discover skills in a directory. Supports two layouts:
 *
 * 1. **Flat:** `root/my-skill/SKILL.md` → skill name `my-skill`
 * 2. **Namespaced:** `root/superworkers/brainstorming/SKILL.md` → skill name `superworkers:brainstorming`
 *
 * A directory is treated as a namespace when it has no SKILL.md
 * but contains subdirectories that do have SKILL.md.
 */
async function discoverSkillsInDirectory(root: string): Promise<SkillMetadata[]> {
  const results: SkillMetadata[] = []
  const topDirs = await listDirectories(root)

  for (const dirName of topDirs) {
    const skillPath = path.join(root, dirName, SKILL_FILE_NAME)

    // Try flat layout first: root/dirName/SKILL.md
    const flatMetadata = await tryLoadSkill(skillPath, dirName)
    if (flatMetadata) {
      results.push(flatMetadata)
      continue
    }

    // No SKILL.md at top level → check if this is a namespace directory
    const subDirs = await listDirectories(path.join(root, dirName))
    for (const subDirName of subDirs) {
      const namespacedPath = path.join(root, dirName, subDirName, SKILL_FILE_NAME)
      const metadata = await tryLoadSkill(namespacedPath, subDirName)
      if (metadata) {
        // Apply namespace: superworkers:brainstorming
        applyNamespace(metadata, dirName)
        results.push(metadata)
      }
    }
  }

  return results
}

async function tryLoadSkill(skillPath: string, dirName: string): Promise<SkillMetadata | null> {
  try {
    const stats = await stat(skillPath)
    if (stats.size > MAX_SKILL_FILE_SIZE) {
      console.warn(
        `[Skills] Skipping ${skillPath}: file size ${(stats.size / 1024).toFixed(1)}KB exceeds ${MAX_SKILL_FILE_SIZE / 1024}KB limit`
      )
      return null
    }
    const content = await readFile(skillPath, 'utf8')
    return parseSkillMetadataFromContent(content, skillPath, dirName)
  } catch {
    return null
  }
}

function applyNamespace(metadata: SkillMetadata, namespace: string): void {
  metadata.name = `${namespace}:${metadata.name}`
  if (metadata.command) {
    const bareName = metadata.command.name
    if (!bareName.includes(':')) {
      metadata.command = {
        ...metadata.command,
        name: `${namespace}:${bareName}`,
        // Keep bare name as alias for convenience: /brainstorming still works
        aliases: [...(metadata.command.aliases ?? []), bareName],
      }
    }
  }
}

export function getDefaultSkillSources(params: {
  userHome?: string;
  projectRoot?: string;
  cwd?: string;
  /** 启用后额外扫描 ~/.claude/skills/（Claude Code 兼容），默认关闭。 */
  claudeSkillsCompat?: boolean;
} = {}): string[] {
  const userHome = params.userHome ?? homedir()
  const projectRoot = resolveWorkspaceRoot({
    projectRoot: params.projectRoot,
    cwd: params.cwd,
  })
  return [
    ...(params.claudeSkillsCompat ? [path.join(userHome, '.claude', 'skills')] : []),
    path.join(userHome, '.codara', 'skills'),
    path.join(projectRoot, '.codara', 'skills')
  ]
}

async function listDirectories(rootPath: string): Promise<string[]> {
  try {
    const entries = await readdir(rootPath, {withFileTypes: true})
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}
