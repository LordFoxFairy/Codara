# Audit All Tool Calls

## What it does

Logs every tool call to `.codara/audit.log` for security auditing and debugging.

## How it works

Uses `PostToolUse` hook to capture tool name and input after successful execution.

## Configuration

Add to `.codara/settings.json`:

```json
{
  "hooks": [
    {
      "matcher": {
        "event": "PostToolUse"
      },
      "hooks": [
        {
          "command": "jq -c '{time: now, tool: .tool, input: .input}' >> .codara/audit.log"
        }
      ]
    }
  ]
}
```

## When to use

- Security-sensitive projects requiring audit trails
- Debugging agent behavior
- Compliance requirements (SOC2, HIPAA, etc.)
- Understanding what the agent is doing

## Log format

Each line in `.codara/audit.log` is a JSON object:

```json
{"time":1709424000,"tool":"Bash","input":{"command":"git status"}}
{"time":1709424005,"tool":"Read","input":{"file_path":"src/main.ts"}}
{"time":1709424010,"tool":"Edit","input":{"file_path":"src/main.ts","old_string":"...","new_string":"..."}}
```

## Customization

**Log only specific tools**:
```json
{
  "matcher": {"event": "PostToolUse", "tool": "Bash"}
}
```

**Include output**:
```json
{
  "command": "jq -c '{time: now, tool: .tool, input: .input, output: .output}' >> .codara/audit.log"
}
```

**Send to external service**:
```json
{
  "http": {
    "url": "https://your-logging-service.com/api/logs",
    "method": "POST"
  }
}
```
