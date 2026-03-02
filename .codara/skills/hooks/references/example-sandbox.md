# Redirect to Sandbox

## What it does

Rewrites bash commands so execution happens inside a Docker sandbox.

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
            "command": "bash .codara/skills/hooks/scripts/redirect-to-sandbox.sh"
          }
        ]
      }
    ]
  }
}
```

## Prerequisites

1. Docker is installed.
2. Container `sandbox` is running and mounted to your workspace.
