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
            "command": "bash .codara/skills/hooks/scripts/log-tool-call.sh"
          }
        ]
      }
    ]
  }
}
```

## Notes

Use JSONL logs for easy grep/jq analysis.
Apply quickly with:

```bash
bash .codara/skills/hooks/scripts/apply-template.sh audit-logger settings.local.json
```
