import {describe, expect, it} from 'bun:test'
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {FileSystemSkillStore} from '@core/skills'

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trim()
}

describe('permission-policy skill scripts', () => {
  it('should expose standard metadata and script assets via skill discovery', async () => {
    const skillsRoot = path.join(process.cwd(), '.codara', 'skills')
    const store = new FileSystemSkillStore({sources: [skillsRoot], cacheTtlMs: 0})
    const discovered = await store.discover()

    const skill = discovered.find((item) => item.name === 'permission-policy')
    expect(skill).toBeDefined()
    expect(skill?.allowedTools).toEqual(['read_file', 'bash'])

    const skillRoot = path.dirname(skill?.path ?? '')
    const scriptPath = path.join(skillRoot, 'scripts', 'evaluate-permission.sh')
    const validatePath = path.join(skillRoot, 'scripts', 'validate-settings.sh')
    const upsertPath = path.join(skillRoot, 'scripts', 'upsert-permission-rule.sh')

    expect(await Bun.file(scriptPath).exists()).toBe(true)
    expect(await Bun.file(validatePath).exists()).toBe(true)
    expect(await Bun.file(upsertPath).exists()).toBe(true)
  })

  it('should evaluate allow/deny/ask decisions from codara settings files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-permission-e2e-'))
    await mkdir(path.join(root, '.codara'), {recursive: true})

    const projectSettings = {
      permissions: {
        defaultDecision: 'ask',
        rules: {
          deny: ['Bash(rm -rf *)'],
          allow: ['Read(*)']
        }
      }
    }

    const localSettings = {
      permissions: {
        rules: {
          allow: ['Bash(git status)']
        }
      }
    }

    await writeFile(path.join(root, '.codara', 'settings.json'), `${JSON.stringify(projectSettings, null, 2)}\n`)
    await writeFile(path.join(root, '.codara', 'settings.local.json'), `${JSON.stringify(localSettings, null, 2)}\n`)

    const skillRoot = path.join(process.cwd(), '.codara', 'skills', 'permission-policy')
    const evaluateScript = path.join(skillRoot, 'scripts', 'evaluate-permission.sh')
    const validateScript = path.join(skillRoot, 'scripts', 'validate-settings.sh')
    const env = {...process.env, HOME: root}

    const validate = Bun.spawnSync({
      cmd: ['bash', validateScript, '--profile', 'codara', '--project-root', root],
      env,
      stdout: 'pipe',
      stderr: 'pipe'
    })

    expect(validate.exitCode).toBe(0)
    expect(decode(validate.stdout)).toContain('OK')

    const allowDecision = Bun.spawnSync({
      cmd: ['bash', evaluateScript, 'Bash(git status)', '--profile', 'codara', '--project-root', root],
      env,
      stdout: 'pipe',
      stderr: 'pipe'
    })

    expect(allowDecision.exitCode).toBe(0)
    const allowPayload = JSON.parse(decode(allowDecision.stdout)) as {
      decision: string;
      matched: {scope: string; bucket: string} | null;
    }
    expect(allowPayload.decision).toBe('allow')
    expect(allowPayload.matched?.scope).toBe('codara_local')
    expect(allowPayload.matched?.bucket).toBe('allow')

    const denyDecision = Bun.spawnSync({
      cmd: ['bash', evaluateScript, 'Bash(rm -rf /tmp/demo)', '--profile', 'codara', '--project-root', root],
      env,
      stdout: 'pipe',
      stderr: 'pipe'
    })

    expect(denyDecision.exitCode).toBe(0)
    const denyPayload = JSON.parse(decode(denyDecision.stdout)) as {
      decision: string;
      matched: {scope: string; bucket: string} | null;
    }
    expect(denyPayload.decision).toBe('deny')
    expect(denyPayload.matched?.scope).toBe('codara_project')
    expect(denyPayload.matched?.bucket).toBe('deny')

    const askDecision = Bun.spawnSync({
      cmd: ['bash', evaluateScript, 'Bash(ls -la)', '--profile', 'codara', '--project-root', root],
      env,
      stdout: 'pipe',
      stderr: 'pipe'
    })

    expect(askDecision.exitCode).toBe(0)
    const askPayload = JSON.parse(decode(askDecision.stdout)) as {
      decision: string;
      matched: {scope: string; bucket: string} | null;
    }
    expect(askPayload.decision).toBe('ask')
    expect(askPayload.matched).toBeNull()
  })

  it('should upsert an allow rule into settings.local.json', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-permission-upsert-'))
    const skillRoot = path.join(process.cwd(), '.codara', 'skills', 'permission-policy')
    const upsertScript = path.join(skillRoot, 'scripts', 'upsert-permission-rule.sh')
    const settingsFile = path.join(root, '.codara', 'settings.local.json')

    const firstWrite = Bun.spawnSync({
      cmd: ['bash', upsertScript, 'Bash(git status)', '--project-root', root],
      stdout: 'pipe',
      stderr: 'pipe'
    })

    expect(firstWrite.exitCode).toBe(0)
    const firstPayload = JSON.parse(decode(firstWrite.stdout)) as {
      created: boolean;
      alreadyPresent: boolean;
      settingsFile: string;
    }
    expect(firstPayload.created).toBe(true)
    expect(firstPayload.alreadyPresent).toBe(false)
    expect(firstPayload.settingsFile).toBe(settingsFile)

    const secondWrite = Bun.spawnSync({
      cmd: ['bash', upsertScript, 'Bash(git status)', '--project-root', root],
      stdout: 'pipe',
      stderr: 'pipe'
    })

    expect(secondWrite.exitCode).toBe(0)
    const secondPayload = JSON.parse(decode(secondWrite.stdout)) as {
      created: boolean;
      alreadyPresent: boolean;
    }
    expect(secondPayload.created).toBe(false)
    expect(secondPayload.alreadyPresent).toBe(true)

    const fileContent = await Bun.file(settingsFile).json() as {
      permissions?: {rules?: {allow?: string[]}};
    }
    expect(fileContent.permissions?.rules?.allow).toEqual(['Bash(git status)'])
  })
})
