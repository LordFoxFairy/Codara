# Hook Skill Playbook

## Why Build Skills First

- Requirements change per team/project.
- Skills are easier to version, review, and share.
- Core remains stable and reusable.

## Build Pattern

1. **Primitive**: hooks/permissions/tools provided by runtime.
2. **Composition**: skill combines primitives for one goal.
3. **Reuse**: copy skill directory to other projects.

## Minimal Template

```text
.codara/skills/<skill-name>/
├── SKILL.md
└── scripts/
    └── main.sh
```

## Policy Skill Checklist

- Hook event chosen correctly.
- Exit code semantics clear (`2` deny, `0` allow/modify).
- Script handles missing input safely.
- No project-specific absolute paths.
- Validation passes: `bun run validate:skills`.

## Config Placement

Use project root:
- `settings.json` for shared defaults
- `settings.local.json` for local overrides
