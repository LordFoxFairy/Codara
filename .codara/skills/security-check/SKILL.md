---
command-name: security-check
description: Enable security checks to block dangerous commands. Use when user wants to "add security", "block dangerous commands", "prevent rm -rf", or "enable safety checks".
user-invocable: true
---

# Security Check

Automatically blocks dangerous commands before they execute.

## What It Does

When enabled, this skill prevents execution of:
- `rm -rf` - Recursive force delete
- `sudo` - Superuser commands
- `chmod 777` - Overly permissive file permissions
- `dd if=` - Disk operations
- `mkfs` - Filesystem formatting
- Commands containing "production" in any form

## How It Works

**Two-layer protection**:

1. **Permissions (First Layer)**: Deny rules block commands immediately
2. **Hooks (Second Layer)**: PreToolUse hook validates and blocks if permissions missed

This ensures safety even if one layer fails.

## Current Status

!`if [ -f .codara/settings.json ]; then echo "📄 Security configuration:"; jq '{permissions: .permissions.deny, hooks: [.hooks[] | select(.matcher.event == "PreToolUse" and (.matcher.pattern | contains("rm -rf") or contains("sudo")))]}' .codara/settings.json 2>/dev/null || echo "Not configured"; else echo "No configuration found"; fi`

## Your Task

The user wants to enable security checks. You should:

1. **Explain what will be blocked** - Show the list above
2. **Confirm with user** - Ask if they want to proceed
3. **Run the installation script** - Execute `bash ${CODARA_SKILL_ROOT}/scripts/install.sh`
4. **Verify installation** - Check that configuration was added

## Installation

Run the installation script:
```bash
bash .codara/skills/security-check/scripts/install.sh
```

This will add both permissions and hooks to `.codara/settings.json`.

## Customization

After installation, users can:
- Add more patterns to block
- Remove patterns they don't need
- Adjust to their workflow

Edit `.codara/settings.json` to customize.

## Disabling

To disable security checks:
1. Remove the deny rules from `permissions.deny`
2. Remove the PreToolUse hooks for security checks
3. Or delete the entire configuration

## Technical Details

**Permissions deny rules**:
```json
{
  "permissions": {
    "deny": [
      "Bash(rm -rf*:*)",
      "Bash(sudo*:*)",
      "Bash(chmod 777*:*)",
      "Bash(dd if=*:*)",
      "Bash(mkfs*:*)",
      "Bash(*production*:*)"
    ]
  }
}
```

**PreToolUse hooks**:
```json
{
  "hooks": [{
    "matcher": {"event": "PreToolUse", "tool": "Bash", "pattern": "rm -rf*"},
    "hooks": [{"command": "echo 'BLOCKED: rm -rf is dangerous' >&2", "exit": 2}]
  }]
}
```
