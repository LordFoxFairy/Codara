---
command-name: skill-dev
description: Guide for creating high-quality Codara skills. Use when user asks to "create a skill", "build a skill", "how to make skills", "skill development guide", or wants to understand skill structure and best practices.
user-invocable: true
---

# Skill Development Guide

Learn how to create effective, well-structured Codara skills that enhance AI capabilities.

## What is a Skill?

A skill is a reusable prompt template that extends Codara's capabilities for specific tasks. Skills can:
- Add domain expertise (e.g., frontend design, code review)
- Automate workflows (e.g., git commits, PR creation)
- Provide specialized knowledge (e.g., MCP integration, testing patterns)

## Skill Structure

### Basic Structure

```
.codara/skills/my-skill/
├── SKILL.md          # Main skill definition (required)
├── references/       # Detailed documentation (optional)
├── examples/         # Code examples (optional)
└── hooks/            # Hook configurations (optional)
```

### SKILL.md Format

```markdown
---
command-name: my-skill
description: Clear description with trigger phrases
user-invocable: true
---

# Skill Content

Your skill instructions here...
```

## Frontmatter Fields

### Required Fields

**command-name**: Unique identifier for the skill
```yaml
command-name: frontend-design
```

**description**: Trigger phrases and purpose (50-500 chars)
```yaml
description: Create distinctive frontend interfaces. Use when user asks to "build UI", "design component", or "create web page".
```

### Optional Fields

**user-invocable**: Can users invoke with `/skill-name`?
```yaml
user-invocable: true   # User can call /my-skill
user-invocable: false  # Auto-triggered only
```

**argument-hint**: Help text for arguments
```yaml
argument-hint: PR number or URL
```

**allowed-tools**: Pre-approved tools for this skill
```yaml
allowed-tools:
  - Bash(git add:*)
  - Bash(git commit:*)
```

## Writing Effective Descriptions

### Good Descriptions

✅ **Specific trigger phrases**:
```yaml
description: Code review a pull request. Use when user says "review PR", "check code quality", or provides PR number.
```

✅ **Clear use cases**:
```yaml
description: Create git commits following project conventions. Use for "commit changes", "save work", or "create commit".
```

### Bad Descriptions

❌ **Too vague**:
```yaml
description: Helps with code
```

❌ **Too technical**:
```yaml
description: Implements AST-based refactoring with multi-pass optimization
```

❌ **Missing triggers**:
```yaml
description: A skill for frontend work
```

## Skill Content Guidelines

### 1. Use Imperative Form

✅ **Good**:
```markdown
To create a component:
1. Read existing patterns
2. Design the interface
3. Implement with tests
```

❌ **Bad**:
```markdown
You should create a component by reading patterns, then you design...
```

### 2. Be Specific and Actionable

✅ **Good**:
```markdown
## Error Handling

Check for these specific errors:
- Network timeouts: Retry 3 times with exponential backoff
- 404 responses: Return null, don't throw
- Auth failures: Clear token and re-authenticate
```

❌ **Bad**:
```markdown
## Error Handling

Handle errors appropriately based on the situation.
```

### 3. Keep SKILL.md Focused (1,000-3,000 words)

If content exceeds 3,000 words, use progressive disclosure:

```markdown
# SKILL.md (core instructions)

## Quick Start
[Essential steps]

## Detailed Guides
- See `references/advanced-patterns.md` for complex scenarios
- See `examples/` for working code samples
```

## Progressive Disclosure

### When to Use references/

Move detailed content to `references/` when:
- SKILL.md exceeds 3,000 words
- Content is reference material (API docs, config options)
- Information is needed occasionally, not always

### Structure Example

```
skill-name/
├── SKILL.md (1,500 words - core workflow)
├── references/
│   ├── api-reference.md (detailed API docs)
│   ├── configuration.md (all config options)
│   └── troubleshooting.md (common issues)
└── examples/
    ├── basic-usage.js
    └── advanced-workflow.js
```

### Linking to References

```markdown
For detailed configuration options, see `references/configuration.md`.

Example implementation: `examples/basic-usage.js`
```

## Skill Types

### 1. Command Skills (user-invocable: true)

User explicitly invokes with `/skill-name`:

```yaml
---
command-name: commit
description: Create a git commit
user-invocable: true
---
```

**Use for**: Explicit actions (commits, reviews, deployments)

### 2. Auto-Triggered Skills (user-invocable: false)

Automatically loaded based on description matching:

```yaml
---
command-name: explanatory-output-style
description: Add educational insights to responses
user-invocable: false
---
```

**Use for**: Output styles, hooks, background behaviors

### 3. Hook Skills

Skills that run on specific events:

```
skill-name/
├── SKILL.md
└── hooks/
    └── hooks.json
```

**hooks.json**:
```json
{
  "SessionStart": {
    "prompt": "references/session-start.md"
  }
}
```

**Use for**: Session initialization, validation, monitoring

## Tool Permissions

### Pre-allowing Tools

```yaml
---
allowed-tools:
  - Bash(git add:*)
  - Bash(git commit:*)
  - Bash(gh pr view:*)
---
```

### Wildcard Patterns

```yaml
allowed-tools:
  - Bash(git *:*)  # All git commands
  - Read           # All Read operations
```

**Security**: Only pre-allow tools the skill genuinely needs.

## Testing Your Skill

### 1. Local Testing

```bash
# Place skill in .codara/skills/
mkdir -p .codara/skills/my-skill
# Create SKILL.md
# Test invocation
/my-skill
```

### 2. Validation Checklist

- [ ] SKILL.md has valid frontmatter
- [ ] Description includes trigger phrases
- [ ] Content is clear and actionable
- [ ] Word count is reasonable (<3,000 for SKILL.md)
- [ ] References are linked correctly
- [ ] Examples work as expected
- [ ] Tools are pre-allowed if needed

### 3. Quality Review

Ask yourself:
- Would a user understand when to use this skill?
- Are instructions specific enough to follow?
- Is content organized logically?
- Are examples complete and correct?

## Common Patterns

### Pattern 1: Workflow Automation

```markdown
---
command-name: deploy
description: Deploy application to production
user-invocable: true
---

## Deployment Workflow

1. Run tests: `npm test`
2. Build production: `npm run build`
3. Deploy: `./scripts/deploy.sh`
4. Verify: Check health endpoint
5. Notify: Post to Slack
```

### Pattern 2: Domain Expertise

```markdown
---
command-name: security-review
description: Review code for security vulnerabilities
user-invocable: true
---

## Security Checklist

### Input Validation
- [ ] SQL injection prevention
- [ ] XSS protection
- [ ] CSRF tokens

### Authentication
- [ ] Password hashing (bcrypt/argon2)
- [ ] Session management
- [ ] Token expiration
```

### Pattern 3: Code Generation

```markdown
---
command-name: api-endpoint
description: Generate REST API endpoint with tests
user-invocable: true
---

## Endpoint Generation

1. Define route and method
2. Create handler function
3. Add input validation
4. Implement business logic
5. Write integration tests
6. Update API documentation
```

## Best Practices

### DO

✅ Use specific trigger phrases in description
✅ Write in imperative/infinitive form
✅ Keep SKILL.md focused and lean
✅ Provide working examples
✅ Use progressive disclosure for long content
✅ Pre-allow only necessary tools
✅ Test skill before sharing

### DON'T

❌ Write vague descriptions
❌ Use second person ("you should...")
❌ Cram everything into SKILL.md
❌ Provide incomplete examples
❌ Pre-allow all tools with wildcards
❌ Skip testing

## Examples

### Minimal Skill

```markdown
---
command-name: hello
description: Say hello to the user
user-invocable: true
---

Greet the user warmly and ask how you can help today.
```

### Complete Skill

```markdown
---
command-name: test-runner
description: Run project tests with coverage. Use when user says "run tests", "check coverage", or "test my code".
user-invocable: true
allowed-tools:
  - Bash(npm test:*)
  - Bash(npm run coverage:*)
---

# Test Runner

## Workflow

1. Detect test framework (Jest, Vitest, Mocha)
2. Run tests: `npm test`
3. Generate coverage: `npm run coverage`
4. Report results with summary
5. Highlight failures with file:line references

## Coverage Thresholds

- Statements: 80%
- Branches: 75%
- Functions: 80%
- Lines: 80%

## Failure Handling

For each failing test:
1. Show test name and error
2. Link to file:line
3. Suggest potential fixes

See `references/test-frameworks.md` for framework-specific details.
```

## Skill Review

After creating a skill, review it:

1. **Description**: Does it have clear trigger phrases?
2. **Content**: Is it specific and actionable?
3. **Length**: Is SKILL.md under 3,000 words?
4. **Organization**: Is content well-structured?
5. **Examples**: Are they complete and correct?
6. **Tools**: Are permissions appropriate?

## Next Steps

1. Create your skill in `.codara/skills/your-skill/`
2. Write SKILL.md with frontmatter and content
3. Add references/ and examples/ if needed
4. Test locally with `/your-skill`
5. Iterate based on usage

## Additional Resources

- **MCP Integration**: See `/mcp-guide` for connecting external services
- **Hook Development**: See `references/hooks.md` for event-driven skills
- **Advanced Patterns**: See `references/advanced-skills.md` for complex workflows

---

**Remember**: Great skills are specific, actionable, and focused. Start simple and iterate based on real usage.
