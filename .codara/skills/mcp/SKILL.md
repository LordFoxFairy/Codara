---
command-name: mcp
description: Guide for integrating Model Context Protocol (MCP) servers. Use when user asks "add MCP", "integrate MCP", "connect external service", "use MCP server", or mentions Model Context Protocol.
user-invocable: true
---

# MCP Integration Guide

Learn how to integrate Model Context Protocol (MCP) servers to connect Codara with external services and APIs.

## What is MCP?

Model Context Protocol enables Codara to interact with external services by providing structured tool access. Use MCP to:
- Connect to databases, APIs, and file systems
- Provide 10+ related tools from a single service
- Handle OAuth and complex authentication
- Integrate hosted services (GitHub, Asana, etc.)

## Quick Start

### 1. Choose MCP Server Type

| Type | Use Case | Example |
|------|----------|---------|
| **stdio** | Local tools, custom servers | File system, local DB |
| **SSE** | Hosted services with OAuth | GitHub, Asana |
| **HTTP** | REST APIs with tokens | Custom backends |
| **WebSocket** | Real-time streaming | Live data feeds |

### 2. Create Configuration

Create `.mcp.json` in your project root or skill directory:

```json
{
  "my-service": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
  }
}
```

### 3. Use MCP Tools

MCP tools are automatically available with prefix:
```
mcp__<server-name>__<tool-name>
```

Example: `mcp__filesystem__read_file`

## Configuration Methods

### Method 1: Project-Level (Recommended)

Create `.mcp.json` at project root:

```json
{
  "database": {
    "command": "python",
    "args": ["-m", "mcp_server_db"],
    "env": {
      "DB_URL": "${DATABASE_URL}"
    }
  }
}
```

**Benefits**: Shared across all skills, easy to maintain

### Method 2: Skill-Level

Create `.mcp.json` in skill directory:

```json
{
  "skill-specific-api": {
    "type": "http",
    "url": "https://api.example.com/mcp",
    "headers": {
      "Authorization": "Bearer ${API_TOKEN}"
    }
  }
}
```

**Benefits**: Isolated to specific skill, portable

## MCP Server Types

### stdio (Local Process)

Run local MCP servers as child processes.

**Configuration**:
```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"],
    "env": {
      "LOG_LEVEL": "debug"
    }
  }
}
```

**Use cases**:
- File system access
- Local database connections
- Custom MCP servers
- NPM-packaged servers

**See**: `references/stdio-servers.md` for details

### SSE (Server-Sent Events)

Connect to hosted MCP servers with OAuth.

**Configuration**:
```json
{
  "github": {
    "type": "sse",
    "url": "https://mcp.github.com/sse"
  }
}
```

**Use cases**:
- Official hosted services (GitHub, Asana)
- Cloud services with OAuth
- No local installation needed

**See**: `references/sse-servers.md` for details

### HTTP (REST API)

Connect to RESTful MCP servers.

**Configuration**:
```json
{
  "api-service": {
    "type": "http",
    "url": "https://api.example.com/mcp",
    "headers": {
      "Authorization": "Bearer ${API_TOKEN}"
    }
  }
}
```

**Use cases**:
- REST API backends
- Token-based authentication
- Stateless interactions

**See**: `references/http-servers.md` for details

### WebSocket (Real-time)

Connect to WebSocket MCP servers.

**Configuration**:
```json
{
  "realtime": {
    "type": "ws",
    "url": "wss://mcp.example.com/ws",
    "headers": {
      "Authorization": "Bearer ${TOKEN}"
    }
  }
}
```

**Use cases**:
- Real-time data streaming
- Push notifications
- Low-latency requirements

**See**: `references/websocket-servers.md` for details

## Environment Variables

All MCP configurations support environment variable substitution:

### Project Root Variable

```json
{
  "command": "${CODARA_PROJECT_ROOT}/servers/my-server"
}
```

Always use for portable paths.

### User Environment Variables

```json
{
  "env": {
    "API_KEY": "${MY_API_KEY}",
    "DATABASE_URL": "${DB_URL}"
  }
}
```

**Best practice**: Document required env vars in README.

## Using MCP Tools

### Tool Naming

MCP tools are prefixed automatically:

**Format**: `mcp__<server-name>__<tool-name>`

**Example**:
- Server: `github`
- Tool: `create_issue`
- **Full name**: `mcp__github__create_issue`

### In Skills

Pre-allow MCP tools in skill frontmatter:

```yaml
---
allowed-tools:
  - mcp__github__create_issue
  - mcp__github__search_issues
---
```

### Wildcard (Use Sparingly)

```yaml
---
allowed-tools:
  - mcp__github__*
---
```

**Security**: Pre-allow specific tools, not wildcards.

## Authentication

### OAuth (SSE/HTTP)

OAuth handled automatically:

```json
{
  "type": "sse",
  "url": "https://mcp.example.com/sse"
}
```

User authenticates in browser on first use.

### Token-Based (Headers)

Static or environment variable tokens:

```json
{
  "type": "http",
  "url": "https://api.example.com",
  "headers": {
    "Authorization": "Bearer ${API_TOKEN}"
  }
}
```

### Environment Variables (stdio)

Pass configuration to MCP server:

```json
{
  "command": "python",
  "args": ["-m", "my_mcp_server"],
  "env": {
    "DATABASE_URL": "${DB_URL}",
    "API_KEY": "${API_KEY}"
  }
}
```

**See**: `references/authentication.md` for detailed patterns

## Integration Patterns

### Pattern 1: Simple Tool Wrapper

Skills use MCP tools with user interaction:

```markdown
# Skill: create-item

1. Gather item details from user
2. Use mcp__api__create_item
3. Confirm creation
```

### Pattern 2: Autonomous Workflow

Multi-step MCP workflows:

```markdown
# Skill: data-analyzer

1. Query data via mcp__db__query
2. Process and analyze results
3. Generate insights report
```

### Pattern 3: Multi-Server Integration

Combine multiple MCP servers:

```json
{
  "github": {
    "type": "sse",
    "url": "https://mcp.github.com/sse"
  },
  "jira": {
    "type": "sse",
    "url": "https://mcp.jira.com/sse"
  }
}
```

**See**: `references/integration-patterns.md` for more examples

## Security Best Practices

### Use Secure Connections

```json
✅ "url": "https://mcp.example.com/sse"
❌ "url": "http://mcp.example.com/sse"
```

### Token Management

**DO**:
- ✅ Use environment variables for tokens
- ✅ Document required env vars
- ✅ Let OAuth handle authentication

**DON'T**:
- ❌ Hardcode tokens in configuration
- ❌ Commit tokens to git
- ❌ Share tokens in documentation

### Permission Scoping

Pre-allow only necessary tools:

```yaml
✅ allowed-tools:
  - mcp__api__read_data
  - mcp__api__create_item

❌ allowed-tools:
  - mcp__api__*
```

## Testing MCP Integration

### 1. Verify Configuration

```bash
# Check .mcp.json syntax
cat .mcp.json | jq .
```

### 2. Test Connection

```bash
# Start Codara and check MCP servers
codara --debug
```

### 3. Test Tool Calls

Create a test skill:

```markdown
---
allowed-tools:
  - mcp__myserver__test_tool
---

Test MCP tool: Use mcp__myserver__test_tool with sample input.
```

### Validation Checklist

- [ ] .mcp.json is valid JSON
- [ ] Server URL is correct and accessible
- [ ] Required environment variables set
- [ ] Tools appear in available tools list
- [ ] Authentication works
- [ ] Tool calls succeed
- [ ] Error cases handled gracefully

## Troubleshooting

### Server Not Connecting

- Check URL is correct
- Verify server is running (stdio)
- Check network connectivity
- Review authentication configuration

### Tools Not Available

- Verify server connected successfully
- Check tool names match exactly
- Restart Codara after config changes

### Authentication Failing

- Clear cached auth tokens
- Re-authenticate
- Check token scopes and permissions
- Verify environment variables set

**See**: `references/troubleshooting.md` for detailed debugging

## Examples

### Example 1: File System Access

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
  }
}
```

**See**: `examples/filesystem.json`

### Example 2: GitHub Integration

```json
{
  "github": {
    "type": "sse",
    "url": "https://mcp.github.com/sse"
  }
}
```

**See**: `examples/github.json`

### Example 3: Custom API

```json
{
  "custom-api": {
    "type": "http",
    "url": "https://api.myservice.com/mcp",
    "headers": {
      "Authorization": "Bearer ${API_TOKEN}",
      "X-API-Version": "v1"
    }
  }
}
```

**See**: `examples/custom-api.json`

## Quick Reference

### Configuration Checklist

- [ ] Server type specified (stdio/SSE/HTTP/ws)
- [ ] Type-specific fields complete
- [ ] Authentication configured
- [ ] Environment variables documented
- [ ] HTTPS/WSS used (not HTTP/WS)
- [ ] Portable paths used

### Best Practices

**DO**:
- ✅ Use environment variables for paths/tokens
- ✅ Document required environment variables
- ✅ Use secure connections (HTTPS/WSS)
- ✅ Pre-allow specific MCP tools
- ✅ Test integration before deploying
- ✅ Handle errors gracefully

**DON'T**:
- ❌ Hardcode absolute paths
- ❌ Commit credentials to git
- ❌ Use HTTP instead of HTTPS
- ❌ Pre-allow all tools with wildcards
- ❌ Skip error handling
- ❌ Forget to document setup

## Additional Resources

### Reference Documentation

- **`references/stdio-servers.md`** - Local stdio servers
- **`references/sse-servers.md`** - Hosted SSE servers
- **`references/http-servers.md`** - REST API servers
- **`references/websocket-servers.md`** - WebSocket servers
- **`references/authentication.md`** - Auth patterns
- **`references/integration-patterns.md`** - Common patterns
- **`references/troubleshooting.md`** - Debugging guide

### Example Configurations

- **`examples/filesystem.json`** - File system access
- **`examples/github.json`** - GitHub integration
- **`examples/custom-api.json`** - Custom API
- **`examples/database.json`** - Database connection

### External Resources

- **Official MCP Docs**: https://modelcontextprotocol.io/
- **MCP SDK**: @modelcontextprotocol/sdk
- **Community Servers**: https://github.com/modelcontextprotocol/servers

## Implementation Workflow

To add MCP integration:

1. Choose MCP server type (stdio, SSE, HTTP, ws)
2. Create `.mcp.json` with configuration
3. Use environment variables for paths/tokens
4. Document required environment variables
5. Test locally
6. Pre-allow MCP tools in skills
7. Handle authentication
8. Test error cases
9. Document integration

---

**Remember**: Start with stdio for custom/local servers, SSE for hosted services with OAuth.
