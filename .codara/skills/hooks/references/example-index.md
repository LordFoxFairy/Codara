# Hooks Examples

Ready-to-use hook configurations for common use cases.

## Available Examples

### 1. Block Dangerous Commands
**File**: `assets/block-dangerous-commands.json`

Prevents execution of dangerous bash commands like `rm -rf` and `sudo`.

- **Event**: PreToolUse
- **Use case**: production safety, shared projects
- **[Full documentation](./example-block-dangerous.md)**

### 2. Audit All Tool Calls
**File**: `assets/audit-all-tools.json`

Logs every tool call to `.codara/audit.log` for auditing.

- **Event**: PostToolUse
- **Use case**: compliance, debugging, security
- **[Full documentation](./example-audit-tools.md)**

### 3. Redirect to Sandbox
**File**: `assets/sandbox-redirect.json`

Redirects bash commands to a sandbox container before execution.

- **Event**: PreToolUse (modify input)
- **Use case**: testing, isolation, CI/CD
- **[Full documentation](./example-sandbox.md)**

## How to Use

1. Pick a template from `assets/`.
2. Merge it into `settings.json`.
3. Trigger the event and verify behavior.

## Combining Examples

```json
{
  "hooks": {
    "PreToolUse": [
      "...security hook...",
      "...sandbox hook..."
    ],
    "PostToolUse": [
      "...audit hook..."
    ]
  }
}
```

## Custom Hook Development

See `hooks-complete.md` for all events and runtime semantics.
