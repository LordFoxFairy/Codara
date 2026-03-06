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

    expect(await Bun.file(scriptPath).exists()).toBe(true)
    expect(await Bun.file(validatePath).exists()).toBe(true)
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
})
