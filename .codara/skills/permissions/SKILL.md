---
command-name: permissions
description: Help users configure permission system. Use when user asks about "permissions", "permission modes", "allowed-tools", "deny rules", or tool access control.
user-invocable: true
---

## Current Project Permissions

!`if [ -f .codara/settings.json ]; then echo "=== .codara/settings.json ==="; jq '.permissions // "No permissions"' .codara/settings.json 2>/dev/null || echo "No permissions"; else echo "No .codara/settings.json"; fi`

!`if [ -f .codara/settings.local.json ]; then echo "\n=== .codara/settings.local.json ==="; jq '.permissions // "No permissions"' .codara/settings.local.json 2>/dev/null || echo "No permissions"; else echo "No .codara/settings.local.json"; fi`

## Your Task

Help the user configure permissions. Ask about their workflow, then provide the exact JSON configuration.

## Quick Reference

**5 Permission Modes**:
- `ask` - Prompt for every tool (maximum control)
- `auto` - Auto-approve safe tools, ask for risky (balanced)
- `acceptEdits` - Auto-approve edits, ask for bash/web (code-focused)
- `dontAsk` - Auto-approve all except denies (trusted automation)
- `bypassPermissions` - No checks (emergency only)

**Rule Syntax**: `ToolName(pattern)`

Examples:
- `Bash(git status:*)` - Allow git status
- `Bash(rm -rf:*)` - Match rm -rf
- `Read` - All Read operations
- `Edit(*.md:*)` - Edit markdown only

**Configuration Format**:
```json
{
  "permissions": {
    "mode": "auto",
    "allow": ["Bash(git *:*)", "Read"],
    "deny": ["Bash(rm -rf:*)", "Bash(sudo:*)"]
  }
}
```

**Evaluation Order**: Bypass → Deny → Allow → Skill → Mode

**Bash Chain Protection**: Each command in `cmd1 && cmd2 && cmd3` is checked separately.

## Ready-to-Use Examples

See `examples/` directory:
- `safe-development.json` - Allow git/npm, deny dangerous commands
- `read-only.json` - Only allow reading and git status
- `sandbox-only.json` - Only allow docker sandbox commands

## Complete Reference

For evaluation chain, pattern matching, and advanced configurations:
[Complete Permissions Documentation](./references/permissions-complete.md)
