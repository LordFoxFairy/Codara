# Security Check Skill

Automatically blocks dangerous commands using both permissions and hooks.

## Design

This skill provides **persistent security checks** by installing configuration to `.codara/settings.json`.

### Two-Layer Protection

1. **Permissions Layer** (First defense)
   - Deny rules block commands immediately
   - Evaluated before hooks
   - Fast and efficient

2. **Hooks Layer** (Second defense)
   - PreToolUse hooks validate commands
   - Provides detailed error messages
   - Backup if permissions fail

### Why Not Use `hooks/hooks.json`?

Skills can have a `hooks/hooks.json` file for **temporary hooks** that are active only when the skill is invoked. However, security checks should be **persistent** and always active, so we install the configuration to `settings.json` instead.

## Usage

```bash
# User invokes the skill
/security-check

# Agent runs the installation script
bash .codara/skills/security-check/scripts/install.sh

# Configuration is added to .codara/settings.json
# Security checks are now always active
```

## Blocked Commands

- `rm -rf` - Recursive force delete
- `sudo` - Superuser commands
- `chmod 777` - Insecure permissions
- `dd if=` - Disk operations
- `mkfs` - Filesystem formatting
- `*production*` - Production-related commands

## Customization

Users can edit `.codara/settings.json` to:
- Add more patterns
- Remove patterns they don't need
- Adjust to their workflow

## Uninstallation

To remove security checks:
1. Edit `.codara/settings.json`
2. Remove the deny rules from `permissions.deny`
3. Remove the PreToolUse hooks for security checks
