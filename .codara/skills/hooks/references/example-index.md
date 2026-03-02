# Hooks Examples

Ready-to-use hook configurations for common use cases.

## Available Examples

### 1. Block Dangerous Commands
**File**: `templates/security-check.json`

Prevents execution of dangerous bash commands like `rm -rf` and `sudo`.

- **Event**: PreToolUse
- **Use case**: production safety, shared projects
- **[Full documentation](./example-block-dangerous.md)**

### 2. Audit All Tool Calls
**File**: `templates/audit-logger.json`

Logs every tool call to `.codara/audit.log` for auditing.

- **Event**: PostToolUse
- **Use case**: compliance, debugging, security
- **[Full documentation](./example-audit-tools.md)**

### 3. Redirect to Sandbox
**File**: `templates/sandbox-redirect.json`

Redirects bash commands to a sandbox container before execution.

- **Event**: PreToolUse (modify input)
- **Use case**: testing, isolation, CI/CD
- **[Full documentation](./example-sandbox.md)**

## How to Use

1. Pick a template from `templates/`.
2. Apply it with `scripts/apply-template.sh`.
3. Trigger the event and verify behavior.

## Combining Examples

```bash
bash .codara/skills/hooks/scripts/apply-template.sh security-check settings.local.json
bash .codara/skills/hooks/scripts/apply-template.sh sandbox-redirect settings.local.json
bash .codara/skills/hooks/scripts/apply-template.sh audit-logger settings.local.json
```

## Custom Hook Development

See `docs/04-hooks.md` for events, runtime semantics, and `PreToolUse` modify/deny behavior.
