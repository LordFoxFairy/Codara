---
name: security-check
command-name: security-check
description: Enable command safety controls that block dangerous shell operations via deny rules and a PreToolUse hook guard. Use when users ask for security checks or dangerous command blocking.
user-invocable: true
---

# Security Check

Block destructive shell commands before execution.

## What This Skill Enforces

- `rm -rf*`
- `sudo*`
- `chmod 777*` / `chmod -R 777*`
- `dd if=*`
- `mkfs*`
- commands containing `production`

## Current Status

!`if [ -f settings.json ]; then echo "=== Security Status (settings.json) ==="; jq '{deny: (.permissions.deny // []), preToolUseHooks: (.hooks.PreToolUse // [])}' settings.json 2>/dev/null || echo "Not configured"; else echo "No configuration found"; fi`

## Your Task

1. Explain what will be blocked.
2. Ask confirmation before installation.
3. Run `bash ${CODARA_SKILL_ROOT}/scripts/install.sh`.
4. Verify deny rules and hook registration.

## Installation

```bash
bash .codara/skills/security-check/scripts/install.sh
```

## Technical Shape

```json
{
  "permissions": {
    "deny": ["Bash(rm -rf *)", "Bash(sudo *)", "Bash(*production*)"]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash .codara/skills/security-check/scripts/check-dangerous-command.sh"
          }
        ]
      }
    ]
  }
}
```
