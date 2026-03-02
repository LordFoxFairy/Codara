---
name: hook-skill-dev
command-name: hook-skill-dev
description: Design and scaffold hook-based Codara skills aligned with skills-first architecture. Use when building custom hook policies, reusable security/audit skills, or hook-driven workflows.
user-invocable: true
---

# Hook Skill Development

Build custom capabilities as skills on top of `hooks` primitives, not as hardcoded core logic.

## Goal

Convert a requirement like "block risky commands", "add audit", or "rewrite tool input" into a reusable skill directory under `.codara/skills/`.

## Ground Rules

1. Keep core runtime generic (`agent loop + hooks engine + permissions engine`).
2. Put strategy/workflow logic in skills.
3. Use project-root config files when needed:
- `settings.json`
- `settings.local.json`

## Workflow

1. Define trigger and behavior in one sentence.
2. Choose hook event (`PreToolUse`, `PostToolUse`, `SessionStart`, etc.).
3. Implement deterministic logic in `scripts/*.sh`.
4. Wire logic via skill hooks (inline `hooks:` or `hooks/hooks.json`).
5. Validate with `bun run validate:skills`.

## Fast Scaffold

Generate a starter hook skill:

```bash
bash ${CODARA_SKILL_ROOT}/scripts/init-hook-skill.sh my-hook-skill
```

This creates:

- `.codara/skills/my-hook-skill/SKILL.md`
- `.codara/skills/my-hook-skill/scripts/main.sh`

## References

- `references/playbook.md`
- `../hooks/references/hooks-complete.md`
- `../permissions/references/permissions-complete.md`
