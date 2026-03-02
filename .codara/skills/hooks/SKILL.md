---
name: hooks
description: Lifecycle hooks toolkit - configure hooks, use ready-made templates (security-check, audit-logger, sandbox), or scaffold custom hook-based skills
user-invocable: true
---

# Lifecycle Hooks Toolkit

Complete toolkit for working with Codara's lifecycle hooks system.

## Current Configuration

!`bash ${CODARA_SKILL_ROOT}/scripts/show-config.sh`

---

## Three Ways to Use This Skill

### 1. Quick Setup: Use Ready-Made Templates

Apply pre-built hook configurations instantly:

**Security Check** - Block dangerous commands:
```bash
# View template
cat ${CODARA_SKILL_ROOT}/templates/security-check.json

# Apply to settings.json
jq -s '.[0] * .[1]' settings.json ${CODARA_SKILL_ROOT}/templates/security-check.json > settings.tmp.json && mv settings.tmp.json settings.json
```

**Audit Logger** - Log all tool calls:
```bash
# View template
cat ${CODARA_SKILL_ROOT}/templates/audit-logger.json

# Apply to settings.json
jq -s '.[0] * .[1]' settings.json ${CODARA_SKILL_ROOT}/templates/audit-logger.json > settings.tmp.json && mv settings.tmp.json settings.json
```

**Sandbox Mode** - Redirect writes to sandbox:
```bash
# View template
cat ${CODARA_SKILL_ROOT}/templates/sandbox-redirect.json

# Apply to settings.json
jq -s '.[0] * .[1]' settings.json ${CODARA_SKILL_ROOT}/templates/sandbox-redirect.json > settings.tmp.json && mv settings.tmp.json settings.json
```

### 2. Custom Configuration: Build Your Own

Use the canonical hooks schema to create custom configurations:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/your-script.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Tool executed: $TOOL_NAME' >> /tmp/log.txt"
          }
        ]
      }
    ]
  }
}
```

**Available Hook Events:**
- `PreToolUse` - Before tool execution (can deny with exit 2)
- `PostToolUse` - After successful tool execution
- `PostToolUseFailure` - After failed tool execution
- `SessionStart` - When session starts
- `SessionStop` - When session ends

**Script Environment Variables:**
- `$TOOL_NAME` - Tool being called
- `$TOOL_INPUT` - Tool input as JSON
- `$TOOL_OUTPUT` - Tool output (PostToolUse only)

**Exit Codes:**
- `0` - Allow/continue
- `2` - Deny/block (PreToolUse only)
- Other - Allow but log error

### 3. Advanced: Scaffold New Hook-Based Skills

Create reusable hook-based skills:

```bash
bash ${CODARA_SKILL_ROOT}/scripts/init-hook-skill.sh my-custom-skill
```

This creates:
- `.codara/skills/my-custom-skill/SKILL.md`
- `.codara/skills/my-custom-skill/scripts/main.sh`

---

## Reusable Scripts

All scripts in `${CODARA_SKILL_ROOT}/scripts/` can be used in your hooks:

**block-dangerous-command.sh** - Security guard:
```json
{
  "type": "command",
  "command": "bash ${CODARA_SKILL_ROOT}/scripts/block-dangerous-command.sh"
}
```

**log-tool-call.sh** - Audit logger:
```json
{
  "type": "command",
  "command": "bash ${CODARA_SKILL_ROOT}/scripts/log-tool-call.sh"
}
```

**redirect-to-sandbox.sh** - Sandbox redirector:
```json
{
  "type": "command",
  "command": "bash ${CODARA_SKILL_ROOT}/scripts/redirect-to-sandbox.sh"
}
```

---

## Templates Reference

| Template | Purpose | Hook Event | Exit Behavior |
|----------|---------|------------|---------------|
| `security-check.json` | Block dangerous commands | PreToolUse | Deny on match |
| `audit-logger.json` | Log all tool calls | PostToolUse | Always allow |
| `sandbox-redirect.json` | Redirect writes to sandbox | PreToolUse | Modify input |

---

## Best Practices

1. **Use absolute paths** in hook commands (or `${CODARA_SKILL_ROOT}`)
2. **Test scripts standalone** before adding to hooks
3. **Keep hooks fast** - they run on every tool call
4. **Use PreToolUse for validation** - can deny with exit 2
5. **Use PostToolUse for logging** - cannot deny
6. **Combine templates** - security + audit works great together

---

## References

- `references/hooks-complete.md` - Complete hooks documentation
- `references/example-index.md` - More examples
- `references/playbook.md` - Hook skill development guide
