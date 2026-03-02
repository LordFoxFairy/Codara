---
name: hooks
command-name: hooks
description: Configure lifecycle hooks and scaffold hook-based skills. Use when users ask about hooks, PreToolUse/PostToolUse, SessionStart, or want to create custom hook-driven workflows.
user-invocable: true
---

# Lifecycle Hooks

Configure hooks with Codara's canonical schema or scaffold new hook-based skills.

## Current Hook Configuration

!`bash ${CODARA_SKILL_ROOT}/scripts/show-config.sh`

## Two Modes

### Mode 1: Configure Hooks (Quick Setup)

For users who want to add hooks to their project:

1. Clarify the target behavior (security, audit, sandbox redirect, validation).
2. Choose the correct hook event.
3. Return complete JSON using the event-keyed format below (for `settings.json` or `settings.local.json` at project root).
4. Verify with the user after configuration is applied.

**Canonical Hook Schema:**

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

**Ready-to-Use Templates:**
- `assets/block-dangerous-commands.json`
- `assets/audit-all-tools.json`
- `assets/sandbox-redirect.json`

### Mode 2: Scaffold Hook Skill (Advanced)

For developers who want to create reusable hook-based skills:

**Quick Scaffold:**

```bash
bash ${CODARA_SKILL_ROOT}/scripts/init-hook-skill.sh my-hook-skill
```

This creates:
- `.codara/skills/my-hook-skill/SKILL.md`
- `.codara/skills/my-hook-skill/scripts/main.sh`

**Design Principles:**
1. Keep core runtime generic (`agent loop + hooks engine + permissions engine`).
2. Put strategy/workflow logic in skills.
3. Use project-root config files when needed: `settings.json`, `settings.local.json`

**Workflow:**
1. Define trigger and behavior in one sentence.
2. Choose hook event (`PreToolUse`, `PostToolUse`, `SessionStart`, etc.).
3. Implement deterministic logic in `scripts/*.sh`.
4. Wire logic via skill hooks (inline `hooks:` or `hooks/hooks.json`).
5. Validate with `bun run validate:skills`.

## References

- `references/example-index.md` - Hook examples
- `references/hooks-complete.md` - Complete hook documentation
- `references/playbook.md` - Hook skill development playbook
