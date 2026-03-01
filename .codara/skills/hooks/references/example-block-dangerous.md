# Block Dangerous Commands

## What it does

Prevents the agent from executing dangerous bash commands:
- `rm -rf` - Recursive force delete
- `sudo` - Superuser commands

## How it works

Uses `PreToolUse` hook with exit code 2 to deny execution before the command runs.

## Configuration

Add to `.codara/settings.json`:

```json
{
  "hooks": [
    {
      "matcher": {
        "event": "PreToolUse",
        "tool": "Bash",
        "pattern": "rm -rf*"
      },
      "hooks": [
        {
          "command": "echo 'Blocked: rm -rf is dangerous' >&2",
          "exit": 2
        }
      ]
    },
    {
      "matcher": {
        "event": "PreToolUse",
        "tool": "Bash",
        "pattern": "sudo*"
      },
      "hooks": [
        {
          "command": "echo 'Blocked: sudo requires manual approval' >&2",
          "exit": 2
        }
      ]
    }
  ]
}
```

## When to use

- Production environments where destructive commands must be prevented
- Shared projects where multiple people use the agent
- Learning environments to prevent accidents

## Customization

Add more patterns to block:
- `chmod 777*` - Overly permissive file permissions
- `dd if=*` - Disk operations
- `mkfs*` - Filesystem formatting
- `*production*` - Any command containing "production"
