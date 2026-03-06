---
name: basic-task-flow
description: Use this skill for straightforward implementation tasks that need a stable execution checklist and concise delivery.
license: MIT
compatibility: codara-agent-runtime
metadata:
  category: general
  level: baseline
allowed-tools:
  - read_file
---
# Basic Task Flow Skill

## When to use
- User asks for a direct implementation with verification.
- Task scope is clear and does not require domain-specialized strategies.

## Workflow
1. Read related files before editing.
2. Make minimal, targeted changes.
3. Run local checks relevant to the touched scope.
4. Report concrete outcomes and any residual risks.

## Quality bar
- Keep changes small and reversible.
- Prefer standard project patterns over novel abstractions.
- Do not add non-essential runtime complexity.

## References
- Read `references/checklist.md` when you need a compact delivery checklist.
