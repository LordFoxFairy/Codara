---
command-name: audit-logger
description: Enable audit logging to track all tool calls. Use when user wants to "enable audit log", "track tool usage", "log all commands", or "enable compliance logging".
user-invocable: true
---

# Audit Logger

Automatically logs all tool calls for auditing, debugging, and compliance.

## What It Does

Records every tool call to `.codara/audit.log` with:
- **Timestamp** - When the tool was called
- **Tool name** - Which tool was used (Bash, Read, Edit, etc.)
- **Input** - What parameters were passed
- **Session ID** - Which session made the call

## Use Cases

**Compliance**: Meet SOC2, HIPAA, or other audit requirements
**Debugging**: Understand what the agent did
**Security**: Track suspicious activity
**Analytics**: Analyze tool usage patterns

## Current Status

!`if [ -f .codara/audit.log ]; then echo "📊 Audit log exists:"; wc -l .codara/audit.log | awk '{print $1 " entries"}'; echo ""; echo "Recent entries:"; tail -3 .codara/audit.log; else echo "Audit logging not enabled"; fi`

!`if [ -f .codara/settings.json ]; then echo ""; echo "📄 Configuration:"; jq '[.hooks[] | select(.matcher.event == "PostToolUse")] | length' .codara/settings.json 2>/dev/null | awk '{if($1>0) print "✓ Audit hooks configured"; else print "✗ No audit hooks"}'; else echo "No configuration found"; fi`

## Your Task

The user wants to enable audit logging. You should:

1. **Explain what will be logged** - Show the information above
2. **Confirm with user** - Ask if they want to proceed
3. **Run the installation script** - Execute `bash ${CODARA_SKILL_ROOT}/scripts/install.sh`
4. **Verify installation** - Check that hooks were added

## Installation

Run the installation script:
```bash
bash .codara/skills/audit-logger/scripts/install.sh
```

This will add PostToolUse hooks to `.codara/settings.json`.

## Log Format

Each log entry is a JSON line:
```json
{"time":1709424000,"tool":"Bash","input":{"command":"git status"},"sessionId":"abc-123"}
{"time":1709424005,"tool":"Read","input":{"file_path":"src/main.ts"},"sessionId":"abc-123"}
{"time":1709424010,"tool":"Edit","input":{"file_path":"src/main.ts","old_string":"..."},"sessionId":"abc-123"}
```

## Viewing Logs

**Recent entries**:
```bash
tail -20 .codara/audit.log
```

**Filter by tool**:
```bash
jq 'select(.tool == "Bash")' .codara/audit.log
```

**Count by tool**:
```bash
jq -r '.tool' .codara/audit.log | sort | uniq -c
```

**Today's activity**:
```bash
jq "select(.time > $(date -d 'today 00:00' +%s))" .codara/audit.log
```

## Customization

After installation, edit `.codara/settings.json` to:

**Log only specific tools**:
```json
{
  "matcher": {"event": "PostToolUse", "tool": "Bash"}
}
```

**Include output** (verbose):
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

## Disabling

To disable audit logging:
1. Remove the PostToolUse hooks from `.codara/settings.json`
2. Optionally delete `.codara/audit.log`

## Privacy Note

Audit logs may contain sensitive information:
- File paths and contents
- Command arguments
- API keys or tokens in commands

**Recommendations**:
- Add `.codara/audit.log` to `.gitignore`
- Rotate logs regularly
- Sanitize logs before sharing

## Technical Details

**PostToolUse hook**:
```json
{
  "hooks": [{
    "matcher": {"event": "PostToolUse"},
    "hooks": [{
      "command": "jq -c '{time: now, tool: .tool, input: .input, sessionId: .sessionId}' >> .codara/audit.log"
    }]
  }]
}
```

The hook runs after every successful tool call and appends a JSON entry to the log file.
