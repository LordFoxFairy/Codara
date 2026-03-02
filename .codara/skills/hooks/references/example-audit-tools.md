# Audit All Tool Calls

## What it does

Logs each tool call to `.codara/audit.log`.

## Configuration

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

## Notes

Use JSONL logs for easy grep/jq analysis.
