import {describe, expect, it} from 'bun:test'
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {FileSystemSkillStore, getDefaultSkillSources} from '@core/skills'

interface FileSystemSkillStoreOptions {
  sources?: string[]
  userHome?: string
  projectRoot?: string
  cacheTtlMs?: number
}

const SKILL_CONTENT = `---
name: demo-skill
description: demo skill
allowed-tools:
  - read_file
custom-threshold: 0.8
custom-config:
  tier: pro
---
# Demo Skill
`

describe('FileSystemSkillStore', () => {
  it('should discover skills from filesystem source', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-skills-store-'))
    const skillDir = path.join(root, 'demo-skill')
    await mkdir(skillDir, {recursive: true})
    await writeFile(path.join(skillDir, 'SKILL.md'), SKILL_CONTENT, 'utf8')

    const options: FileSystemSkillStoreOptions = {sources: [root], cacheTtlMs: 0}
    const store = new FileSystemSkillStore(options)
    const skills = await store.discover()

    expect(skills).toHaveLength(1)
    expect(skills[0]?.name).toBe('demo-skill')
    expect(skills[0]?.allowedTools).toEqual(['read_file'])
    expect(skills[0]?.extensions?.['custom-threshold']).toBe(0.8)
    expect((skills[0]?.extensions?.['custom-config'] as {tier?: string})?.tier).toBe('pro')
  })

  it('should resolve default sources from userHome and projectRoot', () => {
    const options: FileSystemSkillStoreOptions = {
      userHome: '/tmp/codara-home',
      projectRoot: '/tmp/codara-project'
    }
    const sources = getDefaultSkillSources(options)

    expect(sources).toEqual([
      path.join('/tmp/codara-home', '.codara', 'skills'),
      path.join('/tmp/codara-project', '.codara', 'skills')
    ])
  })

  it('should skip skill file without valid frontmatter', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-skills-store-invalid-'))
    const skillDir = path.join(root, 'invalid-skill')
    await mkdir(skillDir, {recursive: true})
    await writeFile(path.join(skillDir, 'SKILL.md'), '# Missing frontmatter', 'utf8')

    const store = new FileSystemSkillStore({sources: [root], cacheTtlMs: 0})
    const skills = await store.discover()
    expect(skills).toHaveLength(0)
  })

  it('should always use real SKILL.md path instead of frontmatter path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-skills-store-path-'))
    const skillDir = path.join(root, 'path-skill')
    await mkdir(skillDir, {recursive: true})
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: path-skill
description: path test
path: /tmp/fake/path/SKILL.md
---
# Path Skill
`,
      'utf8'
    )

    const store = new FileSystemSkillStore({sources: [root], cacheTtlMs: 0})
    const skills = await store.discover()
    expect(skills).toHaveLength(1)
    expect(skills[0]?.path).toBe(path.join(skillDir, 'SKILL.md'))
    expect(skills[0]?.extensions?.path).toBe('/tmp/fake/path/SKILL.md')
  })
})
