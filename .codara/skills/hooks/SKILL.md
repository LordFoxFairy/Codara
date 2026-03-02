---
name: hooks
command-name: hooks
description: Configure lifecycle hooks using Codara's event-based hooks schema. Use when users ask about hooks, PreToolUse/PostToolUse, SessionStart, or want automation around tool calls.
user-invocable: true
---

# Lifecycle Hooks

Configure hooks with Codara's canonical schema and provide complete, runnable JSON.

## Current Hook Configuration

!`bash ${CODARA_SKILL_ROOT}/scripts/show-config.sh`

## Your Task

1. Clarify the target behavior (security, audit, sandbox redirect, validation).
2. Choose the correct hook event.
3. Return complete JSON using the event-keyed format below (for `settings.json` or `settings.local.json` at project root).
4. Verify with the user after configuration is applied.

## Canonical Hook Schema

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "bash ./scripts/check.sh" }
        ]
      }
    ],
    "PostToolUse": []
  }
}
```

- `hooks` is an object keyed by event name.
- `matcher` matches tool names (`Bash`, `Read`, `*`).
- command hooks enforce policy by exit code (`2` denies, `0` allows).

## Ready-to-Use Templates

- `assets/block-dangerous-commands.json`
- `assets/audit-all-tools.json`
- `assets/sandbox-redirect.json`

## References

- `references/example-index.md`
- `references/hooks-complete.md`
