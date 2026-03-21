---
name: builtin-agents
description: Built-in subagent definitions for task delegation
user-invocable: false
---

This skill provides the named subagent types used by Task delegation.

The built-in `Agent` child is owned by the runtime and inherits the main-agent baseline directly, so only explicit named profiles live here:

- `Explore`
- `Plan`

These named profiles are intentionally richer than a one-line persona. They define:

- the delegation boundary for a fresh child session;
- what the child should and should not do;
- the expected shape of the report it returns to the parent;
- the narrow tool surface appropriate for that role.

Each agent definition lives in `agents/*.md` so the runtime can discover and override them through the normal skills filesystem flow. Project skills may still override these named profiles, but they must not recreate the runtime-owned `Agent` base child.
