---
name: permission-policy
description: Use this skill to evaluate tool permissions with deny->ask->allow and produce a transport-agnostic decision that any terminal or middleware can consume.
license: MIT
compatibility: codara-agent-runtime
metadata:
  category: safety
  level: strict
allowed-tools:
  - read_file
  - bash
---
# Permission Policy Skill

## Goal
Provide one reusable permission workflow for different coding terminals and runtimes.

This skill outputs a normalized decision:
- `allow`: execute tool call
- `ask`: require interactive approval
- `deny`: block tool call

## Core policy model
- Rule order: `deny -> ask -> allow`
- Rule syntax: `Tool` or `Tool(specifier)`
- Wildcard: `*`
- Fallback: safe default `ask` unless configuration explicitly states otherwise

## Source profiles
Use one of these profiles when evaluating policy files:

1. `codara` (native generic profile)
- `.codara/settings.local.json`
- `.codara/settings.json`
- `~/.codara/settings.json`

2. `claude` (compatibility profile)
- managed settings path (if present)
- `.claude/settings.local.json`
- `.claude/settings.json`
- `~/.claude/settings.json`

3. `auto`
- Resolve `codara` profile first, then `claude` compatibility profile.
- Use when the runtime may run in mixed environments.

## File formats
### Generic settings format (recommended)
```json
{
  "permissions": {
    "defaultDecision": "ask",
    "rules": {
      "deny": ["Bash(rm -rf *)"],
      "ask": ["Bash(*)"],
      "allow": ["Read(*)"]
    }
  }
}
```

For explicit override files passed with `--policy-file`, root-level generic permission JSON is also supported.

### Claude compatibility format
Read from `permissions` object in settings JSON.
Map `permissions.defaultMode` to normalized fallback decision:
- `bypassPermissions` -> `allow`
- `dontAsk` -> `deny`
- others -> `ask`

## Scripts
- `scripts/evaluate-permission.sh`
  - input: one tool expression, e.g. `Bash(git status)`
  - output: normalized JSON decision + matched rule + source file
  - supports `--profile codara|claude|auto` and `--policy-file` overrides
- `scripts/validate-settings.sh`
  - validates policy/settings files for both generic and Claude-compatible formats
- `scripts/upsert-permission-rule.sh`
  - persists one normalized rule into the current project's `.codara/settings.local.json`

## Decision handoff contract
Permission decision output is transport-agnostic.
Interaction layer can be HIL middleware, GUI approval dialog, CLI prompt, or remote reviewer service.

Runtime contract:
1. evaluate decision
2. `allow` -> execute
3. `deny` -> block with reason
4. `ask` -> pass decision payload to interaction middleware and wait for resume

Suggested terminal interaction template for code terminals:
- `{id: 'allow_once', label: 'Allow once', kind: 'primary'}`
- `{id: 'always', label: 'Always allow', kind: 'secondary'}`
- `{id: 'edit', label: 'Edit command', kind: 'secondary', requiresToolEdit: true}`
- `{id: 'deny', label: 'Deny', kind: 'danger', requiresConfirmation: true}`

When the user chooses `always`, persist the approval by updating the current project's `.codara/settings.local.json` instead of storing it in HIL state.

Recommended resume payload fields:
- `action`
- `scope`
- `comment`
- `editedToolName`
- `editedToolArgs`

## References
- `references/permission-rule-syntax.md`
- `references/policy-sources.md`
- `references/decision-handoff.md`
- `examples/codara-settings.template.json`
