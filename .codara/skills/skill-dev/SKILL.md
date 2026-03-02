---
name: skill-dev
command-name: skill-dev
description: Design, create, or refactor Codara skills with maintainable structure and consistent schema. Use when users ask how to build skills, improve existing skills, or enforce skills-first extension design.
user-invocable: true
---

# Skill Development Guide

Build skills as the only extension entrypoint: core runtime stays generic, behavior expands through skills.

## Canonical Skill Structure

```text
.codara/skills/<skill-name>/
├── SKILL.md                # required
├── scripts/                # optional, executable logic
├── references/             # optional, detailed docs
├── assets/                 # optional, templates/examples
├── hooks/                  # optional, hooks.json
└── agents/                 # optional, agent definitions
```

## Frontmatter Baseline

```yaml
---
name: my-skill
description: What it does + clear trigger phrases for when to use it.
user-invocable: true
allowed-tools: "Read(*),Grep(*),Bash(git *)"
---
```

Use `name` as canonical skill identifier. Keep legacy `command-name` only for backward compatibility during migration.

## Workflow

1. Define concrete trigger phrases from real user requests.
2. Keep `SKILL.md` focused on workflow; move long details to `references/`.
3. Put deterministic logic in `scripts/` (not inline prompt prose).
4. If the skill needs hooks, use event-keyed `hooks` schema.
5. Keep permissions minimal (`allowed-tools` least privilege).
6. Validate JSON, links, and shell scripts before shipping.

## Validation Checklist

```bash
# JSON syntax
find .codara/skills/<skill-name> -name '*.json' -print0 | xargs -0 -I{} jq empty {}

# Shell syntax
find .codara/skills/<skill-name>/scripts -type f -name '*.sh' -print0 | xargs -0 -I{} bash -n {}

# Broken local links (quick scan)
rg -n "\]\((\./|\.\./)[^)]+\)" .codara/skills/<skill-name>
```

## Design Rules

- Do not hardcode feature behavior in core runtime when it can be a skill.
- Do not duplicate large reference content inside `SKILL.md`.
- Do not use stale schema examples (`mode: auto`, `Bash(...:*)`, array-style hooks).
- Keep examples runnable and path-correct inside the repository.

## Related Docs

- `docs/06-skills.md`
- `docs/design-alignment.md`
