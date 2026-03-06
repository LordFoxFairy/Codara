import {readdir, readFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import path from 'node:path'
import {parseSkillMetadataFromContent} from '@core/skills/loading'
import {skillsMetadataReducer} from '@core/skills/metadata'
import type {SkillMetadata, SkillStore} from '@core/skills/types'

const DEFAULT_CACHE_TTL_MS = 5_000
const SKILL_FILE_NAME = 'SKILL.md'

interface SkillCacheEntry {
  expiresAt: number
  skills: SkillMetadata[]
}

/**
 * Filesystem-backed discovery for SkillsMiddleware.
 * Sources are loaded in order, and later sources override earlier ones.
 */
export class FileSystemSkillStore implements SkillStore {
  private readonly sources: string[]
  private readonly cacheTtlMs: number
  private cache: SkillCacheEntry | null = null

  constructor(
    options: {sources?: string[]; userHome?: string; projectRoot?: string; cacheTtlMs?: number} = {}
  ) {
    this.sources = options.sources && options.sources.length > 0
      ? options.sources
      : getDefaultSkillSources({
          userHome: options.userHome,
          projectRoot: options.projectRoot
        })
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  }

  async discover(): Promise<SkillMetadata[]> {
    if (this.cacheTtlMs > 0 && this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.skills
    }

    let mergedSkills: SkillMetadata[] = []

    for (const root of this.sources) {
      const sourceSkills: SkillMetadata[] = []
      const skillDirs = await listDirectories(root)
      for (const dirName of skillDirs) {
        const skillPath = path.join(root, dirName, SKILL_FILE_NAME)
        try {
          const content = await readFile(skillPath, 'utf8')
          const metadata = parseSkillMetadataFromContent(content, skillPath, dirName)
          if (!metadata) {
            continue
          }
          sourceSkills.push(metadata)
        } catch {
          // Skip unreadable/invalid skill files.
        }
      }
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
}

export function getDefaultSkillSources(params: {userHome?: string; projectRoot?: string} = {}): string[] {
  const userHome = params.userHome ?? homedir()
  const projectRoot = params.projectRoot ?? process.cwd()
  return [
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
