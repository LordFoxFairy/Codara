---
command-name: hooks
description: Help users configure lifecycle hooks. Use when user asks about "hooks", "PreToolUse", "SessionStart", hook events, or wants to add hook behaviors.
user-invocable: true
---

# Lifecycle Hooks

Hooks let you run custom actions at specific moments in the agent's lifecycle.

## What You Can Do

**Security**: Block dangerous commands before they execute
**Auditing**: Log all tool calls for compliance
**Isolation**: Redirect commands to a sandbox
**Validation**: Check inputs before processing
**Integration**: Send notifications to external services

## Your Task

Help the user add hooks to their project:

1. **Ask what they want to achieve** - Security? Auditing? Validation?
2. **Recommend the right approach** - Which event and configuration?
3. **Provide complete JSON** - Ready to copy into `.codara/settings.json`

## Common Use Cases

### Security: Block Dangerous Commands
Prevent `rm -rf` and `sudo` from executing.

**Template**: `assets/block-dangerous-commands.json`
**Event**: PreToolUse (before command execution)
**How**: Exit code 2 denies execution

### Auditing: Log All Tool Calls
Record every tool call to `.codara/audit.log`.

**Template**: `assets/audit-all-tools.json`
**Event**: PostToolUse (after successful execution)
**How**: Appends JSON log with timestamp, tool, input

### Isolation: Redirect to Sandbox
Run all bash commands inside Docker container.

**Template**: `assets/sandbox-redirect.json`
**Event**: PreToolUse (modifies command)
**How**: Wraps command with `docker exec`

---

!`bash ${CODARA_SKILL_ROOT}/scripts/show-config.sh`

---

## Available Events

Hooks trigger at 16 lifecycle moments:

**Session**: Start/end of agent session
**User Input**: When user submits prompt
**Tool Lifecycle**: Before/after tool execution, on failure
**Agent Control**: When agent stops, when permissions requested
**Subagent**: When spawning/ending subagents
**Skill**: When loading/unloading skills
**Worktree**: When creating/removing worktrees
**Plan Mode**: When entering/exiting plan mode

## Configuration Format

```json
{
  "hooks": [{
    "matcher": {
      "event": "PreToolUse",
      "tool": "Bash",
      "pattern": "rm -rf*"
    },
    "hooks": [{
      "command": "echo 'Blocked' >&2",
      "exit": 2
    }]
  }]
}
```

## Hook Types

**Command**: Run shell script
**HTTP**: Send webhook
**Prompt**: Ask Claude to analyze
**Agent**: Spawn subagent to review

## Special Capabilities

**PreToolUse** can deny or modify:
- Exit 2 → Deny execution
- Exit 0 + JSON → Modify tool input

**Stop** can force continue:
- Exit 2 → Prevent agent from stopping

## Environment Variables

Hooks receive context:
- `SESSION_ID`, `CWD` - Always available
- `TOOL_NAME`, `TOOL_INPUT` - For tool events
- `TOOL_OUTPUT`, `TOOL_ERROR` - For post-execution

## Next Steps

1. Choose a template from `assets/` or describe your need
2. Copy JSON to `.codara/settings.json`
3. Test by triggering the event

**Detailed documentation**: `references/hooks-complete.md`
