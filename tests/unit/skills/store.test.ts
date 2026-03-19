import {describe, expect, it} from 'bun:test'
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {FileSystemSkillStore, getDefaultSkillSources} from '@capability/skill'

interface FileSystemSkillStoreOptions {
  sources?: string[]
  userHome?: string
  cwd?: string
  projectRoot?: string
  cacheTtlMs?: number
}

const SKILL_CONTENT = `---
name: demo-skill
description: demo skill
command-name: demo
command-aliases:
  - ds
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
    expect(skills[0]?.command).toEqual({
      name: 'demo',
      aliases: ['ds'],
    })
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

  it('should resolve default project sources from the nearest workspace root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-skills-store-root-'))
    const projectRoot = path.join(root, 'project')
    const nestedCwd = path.join(projectRoot, 'packages', 'app')
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true})
    await mkdir(nestedCwd, {recursive: true})

    const sources = getDefaultSkillSources({
      userHome: '/tmp/codara-home',
      cwd: nestedCwd,
    })

    expect(sources).toEqual([
      path.join('/tmp/codara-home', '.codara', 'skills'),
      path.join(projectRoot, '.codara', 'skills')
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

  it('should parse frontmatter from CRLF skill files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-skills-store-crlf-'))
    const skillDir = path.join(root, 'brainstorming')
    await mkdir(skillDir, {recursive: true})
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: brainstorming',
        'description: "You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation."',
        '---',
        '',
        '# Brainstorming',
        '',
      ].join('\r\n'),
      'utf8'
    )

    const store = new FileSystemSkillStore({sources: [root], cacheTtlMs: 0})
    const skills = await store.discover()

    expect(skills).toHaveLength(1)
    expect(skills[0]?.name).toBe('brainstorming')
    expect(skills[0]?.description).toContain('Explores user intent')
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

  it('should discover namespaced skills from nested directories (Codex-style)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-skills-ns-'))
    // Create namespace dir: superworkers/brainstorming/SKILL.md
    const nsDir = path.join(root, 'superworkers', 'brainstorming')
    await mkdir(nsDir, {recursive: true})
    await writeFile(path.join(nsDir, 'SKILL.md'), `---
name: brainstorming
description: brainstorming skill
---
# Brainstorming
`, 'utf8')

    // Also create a flat skill alongside: my-skill/SKILL.md
    const flatDir = path.join(root, 'my-skill')
    await mkdir(flatDir, {recursive: true})
    await writeFile(path.join(flatDir, 'SKILL.md'), `---
name: my-skill
description: flat skill
---
# My Skill
`, 'utf8')

    const store = new FileSystemSkillStore({sources: [root], cacheTtlMs: 0})
    const skills = await store.discover()

    expect(skills).toHaveLength(2)
    const names = skills.map(s => s.name).sort()
    expect(names).toEqual(['my-skill', 'superworkers:brainstorming'])
  })

  it('should namespace command names and keep bare alias', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-skills-ns-cmd-'))
    const nsDir = path.join(root, 'myns', 'code-review')
    await mkdir(nsDir, {recursive: true})
    await writeFile(path.join(nsDir, 'SKILL.md'), `---
name: code-review
description: code review
command-name: review
command-aliases:
  - cr
---
# Code Review
`, 'utf8')

    const store = new FileSystemSkillStore({sources: [root], cacheTtlMs: 0})
    const skills = await store.discover()

    expect(skills).toHaveLength(1)
    expect(skills[0]?.name).toBe('myns:code-review')
    expect(skills[0]?.command?.name).toBe('myns:review')
    // Bare 'review' kept as alias for convenience
    expect(skills[0]?.command?.aliases).toContain('review')
    expect(skills[0]?.command?.aliases).toContain('cr')
  })
})
