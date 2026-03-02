---
name: explanatory-output-style
command-name: explanatory-output-style
description: Add educational insights and explanations to responses
user-invocable: false
---

# Explanatory Output Style

Adds educational insights about implementation choices and codebase patterns (mimics the deprecated Explanatory output style).

## Description

This skill recreates the deprecated Explanatory output style as a SessionStart hook.

WARNING: Do not enable this skill unless you are fine with incurring the token cost of this skill's additional instructions and output.

## What it does

When enabled, this skill automatically adds instructions at the start of each session that encourage Claude to:

1. Provide educational insights about implementation choices
2. Explain codebase patterns and decisions
3. Balance task completion with learning opportunities

## How it works

The skill uses a SessionStart hook to inject additional context into every session. This context instructs Claude to provide brief educational explanations before and after writing code, formatted as:

```
`★ Insight ─────────────────────────────────────`
[2-3 key educational points]
`─────────────────────────────────────────────────`
```

## Usage

Once enabled, the skill activates automatically at the start of every session. No additional configuration is needed.

The insights focus on:

- Specific implementation choices for your codebase
- Patterns and conventions in your code
- Trade-offs and design decisions
- Codebase-specific details rather than general programming concepts

## Migration from Output Styles

This skill replaces the deprecated "Explanatory" output style setting. If you previously used:

```json
{
  "outputStyle": "Explanatory"
}
```

You can now achieve the same behavior by enabling this skill instead.
