---
name: builtin-agents
description: Built-in agent types for sub-agent delegation - Explore (fast codebase search), Plan (architecture design), and general-purpose (full capabilities)
user-invocable: false
---

# Built-in Agent Types

Codara includes three pre-configured agent types for common sub-agent delegation patterns.

## Available Agent Types

### 1. Explore (Fast Codebase Exploration)

**Model**: haiku (fast and cost-effective)
**Tools**: Read, Grep, Glob, Bash (read-only)
**Use Case**: Quick file/code searches, understanding project structure

```typescript
// Usage in Task tool
{
  subagent_type: "Explore",
  prompt: "Find all API endpoints in the codebase"
}
```

**Characteristics**:
- ✅ Fast (uses haiku model)
- ✅ Read-only (cannot modify files)
- ✅ Cost-effective
- ❌ Cannot write code
- ❌ Cannot commit changes

### 2. Plan (Software Architect)

**Model**: inherit (uses parent agent's model)
**Tools**: Read, Grep, Glob, Bash (read-only)
**Use Case**: Design implementation plans, analyze trade-offs

```typescript
// Usage in Task tool
{
  subagent_type: "Plan",
  prompt: "Design an implementation plan for user authentication"
}
```

**Characteristics**:
- ✅ Deep analysis (uses parent's model, usually opus/sonnet)
- ✅ Read-only (focuses on planning, not implementation)
- ✅ Detailed planning
- ❌ Cannot write code
- ❌ Cannot commit changes

### 3. general-purpose (Full Capabilities)

**Model**: inherit (uses parent agent's model)
**Tools**: All tools except Task, AskUserQuestion, AgentOutput
**Use Case**: Complex multi-step tasks requiring code modifications

```typescript
// Usage in Task tool
{
  subagent_type: "general-purpose",
  prompt: "Implement the user authentication feature"
}
```

**Characteristics**:
- ✅ Full file access (Read, Write, Edit)
- ✅ Can run commands
- ✅ Multi-step workflows
- ❌ Cannot spawn sub-agents
- ❌ Cannot ask user questions

---

## Agent Definitions

All agent definitions are in `agents/` directory:
- `agents/Explore.md` - Fast exploration agent
- `agents/Plan.md` - Architecture planning agent
- `agents/general-purpose.md` - Full-capability agent

Each definition includes:
- **Frontmatter**: tools, model, permissions, maxTurns
- **System Prompt**: Role, capabilities, constraints, best practices
- **Usage Guide**: When to use, example workflows

---

## Customization

### Override Built-in Agents

Create your own version in your project:

```bash
.codara/skills/my-agents/agents/Explore.md
```

Project-level agents take precedence over built-in agents.

### Create Custom Agents

Add new agent types by creating new `.md` files:

```bash
.codara/skills/my-agents/agents/
├── Researcher.md      # Custom research agent
├── Tester.md          # Custom testing agent
└── Reviewer.md        # Custom code review agent
```

### Agent Definition Format

```markdown
---
tools: Read, Grep, Glob
model: haiku
permissions:
  deny:
    - Write(*)
    - Edit(*)
maxTurns: 20
---

# Your Agent Name

System prompt and instructions here...
```

---

## Best Practices

1. **Choose the Right Agent**:
   - Explore: Quick searches, read-only tasks
   - Plan: Design and planning, no implementation
   - general-purpose: Implementation, modifications

2. **Start Small**: Use Explore first, escalate to general-purpose if needed

3. **Be Specific**: Clear prompts lead to better results

4. **Consider Cost**: Explore (haiku) is cheaper than general-purpose (opus/sonnet)

5. **Customize When Needed**: Override built-in agents for project-specific needs

---

## References

- `docs/06-agent-collaboration.md` - Complete agent collaboration documentation
- `agents/` - Agent definition files
