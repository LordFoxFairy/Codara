---
name: builtin-agents
description: Built-in subagent definitions for task delegation
user-invocable: false
---

This skill provides the default subagent types used by Task delegation:

- `general-purpose`
- `Explore`
- `Plan`

Each agent definition lives in `agents/*.md` so the runtime can discover and override them through the normal skills filesystem flow.
