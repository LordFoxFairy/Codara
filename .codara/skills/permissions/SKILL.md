---
name: permissions
command-name: permissions
description: Configure Codara permissions safely using defaultMode plus allow/deny/ask rules. Use when users ask about permission mode, allowed-tools, deny rules, or tool access policy.
user-invocable: true
---

# Permissions Configuration

## Current Project Permissions

!`if [ -f settings.json ]; then echo "=== settings.json ==="; jq '.permissions // "No permissions"' settings.json 2>/dev/null || echo "No permissions"; else echo "No settings.json"; fi`

!`if [ -f settings.local.json ]; then echo "\n=== settings.local.json ==="; jq '.permissions // "No permissions"' settings.local.json 2>/dev/null || echo "No permissions"; else echo "No settings.local.json"; fi`

## Your Task

1. Ask for workflow intent (interactive dev, read-only review, CI automation).
2. Choose `defaultMode` and minimal rules.
3. Return exact JSON that can be merged into `settings.json` or `settings.local.json` (project root).
4. Explain why each allow/deny/ask rule exists.

## Quick Reference

**Modes**:
- `default`
- `acceptEdits`
- `plan`
- `dontAsk`
- `bypassPermissions`

**Rule syntax**: `ToolName(pattern)`
- `Bash(git *)`
- `Bash(rm -rf *)`
- `Read(*)`
- `Edit(src/**)`

**Evaluation order (summary)**:
`bypass -> plan -> deny -> ask -> allow -> readonly -> acceptEdits -> dontAsk -> ask`

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

## Ready-to-Use Examples

- `examples/safe-development.json`
- `examples/read-only.json`
- `examples/sandbox-only.json`

## Complete Reference

- `references/permissions-complete.md`
