# Codara vs Claude Code Internal Alignment

## Goal

This document compares Codara's current internal runtime against the Claude Code mental model.
It focuses only on internal behavior:

- `createAgent(...)`
- session / conversation hosting
- source injection via `AGENTS.md`
- checkpoint restore
- summary / compact
- session catalog vs runtime snapshots

It explicitly does not cover CLI slash commands or manual UX entrypoints.

## Current Codara Flow

```text
createCodara(...)
  -> createSession(...)
    -> agentsSource(AGENTS.md only)
    -> createAgent(...)
      -> middleware pipeline
         -> guidelines
         -> skills
         -> caller middlewares
         -> conversation-context
            -> budget refresh
            -> optional summary compact
         -> hil
      -> model/tool loop
      -> checkpoint
```

### Current Responsibility Split

```text
createAgent(...)
  = execution kernel
  = messages/context/values
  = loop, tools, resume, checkpoint restore

Session
  = conversation host
  = source reload
  = checkpoint compaction
  = pause resume entry
  = session metadata updates

SessionStore
  = conversation catalog / index
  = list/open/latest sessions
  = stores session metadata, not runtime state

Checkpoint Store
  = runtime snapshot history
  = messages/context/values/pendingPause chain
```

## Claude Code Mental Model

Claude Code behaves more like this:

```text
Conversation Catalog
  -> list/open/latest conversations

Conversation Session
  -> choose/open a conversation
  -> load layered CLAUDE.md sources
  -> restore latest runtime snapshot
  -> manage conversation context lifecycle

Agent Runtime
  -> messages/context/tool loop
  -> compaction / summary
  -> tool execution

Checkpoint / Snapshot Store
  -> internal runtime snapshots only
```

The key characteristic is not that Claude Code has fewer concepts.
It is that the concepts feel like one coherent conversation lifecycle.

## What Is Already Aligned

### 1. `createAgent(...)` remains the only execution kernel

This is correct and should not change.

```text
Codara
  session -> createAgent -> runtime loop

Claude Code
  conversation host -> agent runtime loop
```

### 2. `AGENTS.md` now acts like Codara's `CLAUDE.md`

Current `AGENTS.md` behavior is already close to Claude Code's memory/source layer:

- layered discovery from project root to cwd
- simple `@import`
- session-scoped caching
- explicit `reloadSources()`
- model-call injection through middleware

Relevant files:

- [src/core/workspace.ts](/Users/nako/WebstormProjects/github/thefoxfairy/Codara/src/core/workspace.ts)
- [src/core/sessions/agents-source.ts](/Users/nako/WebstormProjects/github/thefoxfairy/Codara/src/core/sessions/agents-source.ts)
- [src/core/middleware/guidelines.ts](/Users/nako/WebstormProjects/github/thefoxfairy/Codara/src/core/middleware/guidelines.ts)

### 3. Resume semantics are cleaner than before

Codara now distinguishes:

- pause resume: `resumePause(...)`
- conversation reopen: `openCodaraSession(...)` / `openLatestCodaraSession(...)`

That is closer to Claude Code than the previous single `resume` idea.

### 4. Compact is correctly split into two concerns

Codara currently distinguishes:

- conversation compaction: `summary`
- storage compaction: `compactCheckpoints(...)`

That split is correct.

## What Is Not Fully Aligned Yet

### 1. Session is correct, but not yet natural enough

The current split is defensible:

```text
SessionStore = conversation catalog
Session      = conversation host
Checkpoint   = runtime state history
```

But the system still feels assembled from layers rather than shaped around one first-class conversation lifecycle.

### 2. Summary is still a middleware, not yet a context manager

Current summary behavior is good:

- compacts older messages
- stores summary inside messages
- cooperates with context budget

But it still feels like:

```text
guidelines + budget + summary + checkpoint
```

instead of a single conversation context subsystem.

Codara has now tightened this one step further:

```text
guidelines + skills + caller prompts
  -> conversation-context
     -> budget refresh
     -> optional summary compact
```

This removes the default runtime's reliance on two separate middleware entries
being kept in the correct order.

### 3. Session catalog and runtime snapshots are separated, but not fully modeled together

This is the current state:

```text
SessionStore -> which conversation exists
Checkpoint   -> where that conversation can resume from
```

This is conceptually right.
The remaining gap is product architecture clarity, not a functional bug.

## Why `SessionStore` Is Not the Same as `checkpoint`

This is the key distinction:

```text
SessionStore
  stores:
    - sessionId
    - threadId
    - title
    - lastMessage
    - lastActivity
  purpose:
    - list/open/latest conversations

Checkpoint
  stores:
    - messages
    - context
    - values
    - pendingPause
    - parent chain
  purpose:
    - restore runtime state
    - continue a conversation safely
```

So:

```text
SessionStore != runtime history
Checkpoint  != conversation catalog
```

This separation is correct.

## Current Compact / Resume Impact

### Resume

```text
resumePause(...)
  -> resumes a paused HIL action

openCodaraSession(...)
openLatestCodaraSession(...)
  -> reopen a conversation
  -> reuse threadId
  -> restore latest checkpoint
  -> hydrate restored runtime state before returning
```

### Compact

```text
summary
  -> changes future model-visible conversation context

compactCheckpoints(...)
  -> trims stored checkpoint history
  -> does not generate summaries
```

This split is currently correct.

## Current Alignment Score

If the target is Claude Code's internal mechanics, current Codara is roughly:

- execution kernel: 90%
- source / instruction loading: 80%
- resume semantics: 80%
- checkpoint semantics: 85%
- conversation lifecycle cohesion: 65%
- context manager maturity: 60%

Overall: about `75%-80%` aligned.

## Recommended Next Refactor Line

Do not add new features first.
Do not add a second runtime.

Instead, continue in this order:

### Phase 1. Formalize conversation lifecycle

Make the architecture explicitly read as:

```text
SessionStore
  -> catalog

Session
  -> conversation host
  -> source lifetime
  -> checkpoint lifetime
  -> conversation metadata

createAgent(...)
  -> runtime execution only
```

### Phase 2. Promote summary + budget into a clearer context subsystem

Keep the existing middleware machinery, but tighten the mental model so that:

```text
AGENTS source
  + current messages
  + budget
  + summary compaction
  = conversation context lifecycle
```

### Phase 3. Reduce leftover ceremony around Codara host assembly

Only after phases 1-2 are stable.

## Final Judgment

Codara is no longer architecturally confused in the way it was before.
The biggest internal mistakes have already been corrected:

- one execution kernel
- separate pause resume vs conversation reopen
- `AGENTS.md` as the single long-lived source layer
- separate checkpoint compaction vs summary compaction

But it is not yet fully Claude Code-aligned.

The remaining gap is no longer "wrong abstractions everywhere".
The remaining gap is:

```text
conversation lifecycle cohesion
```

That is the next place to polish.
