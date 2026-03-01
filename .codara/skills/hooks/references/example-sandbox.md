# Redirect to Sandbox

## What it does

Redirects all bash commands to run inside a Docker sandbox container, preventing any changes to the host system.

## How it works

Uses `PreToolUse` hook with exit code 0 and modified JSON output to change the command before execution.

## Configuration

Add to `.codara/settings.json`:

```json
{
  "hooks": [
    {
      "matcher": {
        "event": "PreToolUse",
        "tool": "Bash"
      },
      "hooks": [
        {
          "command": "echo '{\"command\": \"docker exec sandbox bash -c \\\"'\"$TOOL_INPUT\"'\\\"\"}'",
          "exit": 0
        }
      ]
    }
  ]
}
```

## Prerequisites

1. Docker must be installed and running
2. Create a sandbox container:

```bash
docker run -d --name sandbox \
  -v $(pwd):/workspace \
  -w /workspace \
  ubuntu:latest \
  tail -f /dev/null
```

## When to use

- Testing untrusted code or commands
- Preventing accidental system modifications
- Isolating agent operations from host system
- CI/CD environments

## How it works

**Original command**:
```bash
rm -rf /tmp/test
```

**Modified command**:
```bash
docker exec sandbox bash -c "rm -rf /tmp/test"
```

The command runs inside the container, not on the host.

## Customization

**Use different container**:
```json
{
  "command": "echo '{\"command\": \"docker exec my-container bash -c \\\"'\"$TOOL_INPUT\"'\\\"\"}'",
  "exit": 0
}
```

**Add environment variables**:
```json
{
  "command": "echo '{\"command\": \"docker exec -e NODE_ENV=test sandbox bash -c \\\"'\"$TOOL_INPUT\"'\\\"\"}'",
  "exit": 0
}
```

**Redirect only dangerous commands**:
```json
{
  "matcher": {
    "event": "PreToolUse",
    "tool": "Bash",
    "pattern": "rm *"
  }
}
```

## Limitations

- Container must have necessary tools installed
- File paths must be accessible inside container (use volume mounts)
- Network access may be restricted
- Performance overhead from Docker exec
