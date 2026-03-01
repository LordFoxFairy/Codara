# Hooks Examples

Ready-to-use hook configurations for common use cases.

## Available Examples

### 1. Block Dangerous Commands
**File**: `block-dangerous-commands.json`

Prevents execution of dangerous bash commands like `rm -rf` and `sudo`.

- **Event**: PreToolUse
- **Use case**: Production safety, shared projects
- **[Full documentation](./block-dangerous-commands.md)**

### 2. Audit All Tool Calls
**File**: `audit-all-tools.json`

Logs every tool call to `.codara/audit.log` for security auditing.

- **Event**: PostToolUse
- **Use case**: Compliance, debugging, security
- **[Full documentation](./audit-all-tools.md)**

### 3. Redirect to Sandbox
**File**: `sandbox-redirect.json`

Redirects all bash commands to run inside a Docker sandbox container.

- **Event**: PreToolUse (with modification)
- **Use case**: Testing, isolation, CI/CD
- **[Full documentation](./sandbox-redirect.md)**

## How to Use

1. Choose an example that matches your need
2. Copy the JSON configuration
3. Add to `.codara/settings.json` or `.codara/settings.local.json`
4. Test by triggering the relevant event

## Combining Examples

You can combine multiple hooks in the same configuration:

```json
{
  "hooks": [
    ...block-dangerous-commands hooks...,
    ...audit-all-tools hooks...
  ]
}
```

## Creating Custom Hooks

See the [Complete Hooks Documentation](../references/hooks-complete.md) for:
- All 16 hook events
- Configuration syntax
- Environment variables
- Advanced patterns
