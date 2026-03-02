---
name: permissions
command-name: permissions
description: Configure Codara permission policy using defaultMode plus allow/deny/ask rules. Use when users ask to reduce prompts, enforce least-privilege tool access, choose a mode for review/dev/automation, or audit permission risk.
user-invocable: true
---

# Permissions Toolkit

Use this skill to choose a safe permission posture and produce merge-ready policy JSON.

## Why This Exists

Permissions decide whether a tool call is auto-allowed, blocked, or prompts for approval.

- `defaultMode` defines baseline behavior.
- `allow`, `deny`, and `ask` rules refine that behavior.
- Skill `allowed-tools` adds temporary allow rules but never bypasses user `deny`.

Use `hooks` for deterministic interception or input rewriting.
Use `permissions` for authorization and prompt policy.

## Current Project Permissions

!`bash ${CODARA_SKILL_ROOT}/scripts/show-permissions.sh`

## Workflow

1. Identify intent: `read-only review`, `interactive development`, `unattended automation`, or `emergency bypass`.
2. Choose the narrowest `defaultMode` that satisfies the workflow.
3. Add minimal `allow`, `deny`, `ask` rules with explicit rationale.
4. Return exact JSON for `settings.local.json` first (preferred), or `settings.json` if team-wide policy is intended.
5. Validate with representative commands that should allow, ask, and deny.

## Mode Selection

| Mode | Best For | Risk | Behavior Summary |
|---|---|---|---|
| `plan` | read-only analysis | low | auto-allow read tools; execution tools usually need approval/are blocked by mode policy |
| `default` | mixed workflows | medium | read tools auto-allow, most others ask |
| `acceptEdits` | interactive coding with file edits | medium | read + write/edit workflows are smoother, still policy bounded |
| `dontAsk` | controlled automation | high | no prompts; anything not explicitly allowed is denied |
| `bypassPermissions` | emergency debugging only | critical | effectively allow everything; avoid in normal operation |

## Rule Syntax

- Syntax: `ToolName(pattern)`
- Examples:
  - `Bash(git *)`
  - `Bash(rm -rf *)`
  - `Read(*)`
  - `Edit(src/**)`

Practical precedence:
- `deny` overrides everything else.
- `ask` overrides `allow`.
- `allow` grants only when not denied/asked and mode semantics permit.

See `docs/appendix/permissions.md` and `docs/04-hooks.md` for full evaluation details.

## Canonical Example

```json
{
  "permissions": {
    "defaultMode": "default",
    "allow": ["Read(*)", "Glob(*)", "Grep(*)", "Bash(git *)"],
    "deny": ["Bash(rm -rf *)", "Bash(sudo *)"],
    "ask": ["Bash(npm publish*)"]
  }
}
```

## Quick Templates

Preview a template:

```bash
cat ${CODARA_SKILL_ROOT}/templates/safe-development.json
```

Apply a template:

```bash
bash ${CODARA_SKILL_ROOT}/scripts/apply-template.sh safe-development settings.local.json
bash ${CODARA_SKILL_ROOT}/scripts/apply-template.sh read-only settings.local.json
bash ${CODARA_SKILL_ROOT}/scripts/apply-template.sh sandbox-only settings.local.json
```

If target file is omitted, `settings.local.json` is used.

Template files:
- `templates/safe-development.json`
- `templates/read-only.json`
- `templates/sandbox-only.json`

## Safety Heuristics

- Prefer `settings.local.json` while iterating to avoid accidental team-wide policy changes.
- Keep Bash allow rules narrow (`Bash(git status*)` > `Bash(git *)` when possible).
- Always include high-impact deny rules (for example destructive shell patterns).
- Avoid `bypassPermissions` except for short-lived, explicit emergency sessions.
- Explain the purpose of each rule in the response so policy remains auditable.

## References

- `docs/appendix/permissions.md`
- `docs/04-hooks.md`
- `docs/06-skills.md`
