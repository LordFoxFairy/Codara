# Block Dangerous Commands

## What it does

Prevents the agent from executing dangerous bash commands.

## Configuration

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash .codara/skills/hooks/scripts/block-dangerous-command.sh"
          }
        ]
      }
    ]
  }
}
```

## Notes

The script denies commands by exiting with code `2`, which blocks the tool call.
