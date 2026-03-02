---
name: audit-logger
command-name: audit-logger
description: Enable structured audit logging for tool calls using PostToolUse hooks. Use when users need compliance logs, debugging history, or tool usage tracking.
user-invocable: true
---

# Audit Logger

Log tool activity to `.codara/audit.log` in JSONL format.

## What Is Logged

- time
- tool
- input
- sessionId

## Current Status

!`if [ -f .codara/audit.log ]; then echo "=== .codara/audit.log ==="; wc -l .codara/audit.log | awk '{print $1 " entries"}'; tail -3 .codara/audit.log; else echo "Audit log file not found"; fi`

!`if [ -f settings.json ]; then echo "\n=== Hook Status (settings.json) ==="; jq '.hooks.PostToolUse // [] | length' settings.json 2>/dev/null | awk '{if($1>0) print "PostToolUse hooks configured: " $1; else print "No PostToolUse hooks configured"}'; else echo "No configuration found"; fi`

## Your Task

1. Explain data captured and privacy impact.
2. Ask confirmation.
3. Run `bash ${CODARA_SKILL_ROOT}/scripts/install.sh`.
4. Verify hook and log file creation.

## Installation

```bash
bash .codara/skills/audit-logger/scripts/install.sh
```

## Technical Shape

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "jq -c '{time: now, tool: .tool, input: .input, sessionId: .sessionId}' >> .codara/audit.log"
          }
        ]
      }
    ]
  }
}
```
