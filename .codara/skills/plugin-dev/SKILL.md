---
description: Guided end-to-end plugin creation workflow with component design, implementation, and validation
---

# Plugin Creation Workflow

Guide the user through creating a complete, high-quality Claude Code plugin from initial concept to tested implementation. Follow a systematic approach: understand requirements, design components, clarify details, implement following best practices, validate, and test.

## Core Principles

- Ask clarifying questions: Identify all ambiguities about plugin purpose, triggering, scope, and components
- Load relevant skills: Use the Skill tool to load plugin-dev skills when needed
- Use specialized agents: Leverage agent-creator, plugin-validator, and skill-reviewer agents
- Follow best practices: Apply patterns from plugin-dev's own implementation
- Progressive disclosure: Create lean skills with references/examples
- Use TodoWrite: Track all progress throughout all phases

**Initial request:** $ARGUMENTS

---

## Phase 1: Discovery

**Goal**: Understand what plugin needs to be built and what problem it solves

**Actions**:
1. Create todo list with all 7 phases
2. If plugin purpose is clear from arguments:
   - Summarize understanding
   - Identify plugin type (integration, workflow, analysis, toolkit, etc.)
3. If plugin purpose is unclear, ask user:
   - What problem does this plugin solve?
   - Who will use it and when?
   - What should it do?
   - Any similar plugins to reference?
4. Summarize understanding and confirm with user before proceeding

**Output**: Clear statement of plugin purpose and target users

---

## Phase 2: Component Planning

**Goal**: Determine what plugin components are needed

**MUST load plugin-structure skill** using Skill tool before this phase.

**Actions**:
1. Load plugin-structure skill to understand component types
2. Analyze plugin requirements and determine needed components
3. For each component type needed, identify:
   - How many of each type
   - What each one does
   - Rough triggering/usage patterns
4. Present component plan to user as table
5. Get user confirmation or adjustments

**Output**: Confirmed list of components to create

---

## Phase 3: Detailed Design & Clarifying Questions

**Goal**: Specify each component in detail and resolve all ambiguities

**CRITICAL**: This is one of the most important phases. DO NOT SKIP.

**Actions**:
1. For each component in the plan, identify underspecified aspects
2. Present all questions to user in organized sections
3. Wait for answers before proceeding to implementation
4. If user says "whatever you think is best", provide specific recommendations

**Output**: Detailed specification for each component

---

## Phase 4: Plugin Structure Creation

**Goal**: Create plugin directory structure and manifest

**Actions**:
1. Determine plugin name (kebab-case, descriptive)
2. Choose plugin location and create directory structure
3. Create plugin.json manifest
4. Create README.md template
5. Create .gitignore if needed
6. Initialize git repo if creating new directory

**Output**: Plugin directory structure created and ready for components

---

## Phase 5: Component Implementation

**Goal**: Create each component following best practices

**LOAD RELEVANT SKILLS** before implementing each component type.

**Actions for each component**:

### For Skills:
1. Load skill-development skill
2. Create skill directory structure
3. Write SKILL.md with third-person description and specific trigger phrases
4. Create reference files for detailed content
5. Create example files for working code
6. Create utility scripts if needed
7. Use skill-reviewer agent to validate

### For Commands:
1. Load command-development skill
2. Write command markdown with frontmatter
3. Include clear description and argument-hint
4. Specify allowed-tools (minimal necessary)
5. Write instructions FOR Claude (not TO user)
6. Provide usage examples and tips

### For Agents:
1. Load agent-development skill
2. Use agent-creator agent to generate agent specification
3. Create agent markdown file with frontmatter and system prompt
4. Add appropriate model, color, and tools
5. Validate with validate-agent.sh script

### For Hooks:
1. Load hook-development skill
2. Create hooks/hooks.json with hook configuration
3. Prefer prompt-based hooks for complex logic
4. Use ${CLAUDE_PLUGIN_ROOT} for portability
5. Test with validation utilities

### For MCP:
1. Load mcp-integration skill
2. Create .mcp.json configuration
3. Document required env vars in README
4. Provide setup instructions

### For Settings:
1. Load plugin-settings skill
2. Create settings template in README
3. Create example .claude/plugin-name.local.md file
4. Implement settings reading in hooks/commands
5. Add to .gitignore

**Output**: All plugin components implemented

---

## Phase 6: Validation & Quality Check

**Goal**: Ensure plugin meets quality standards and works correctly

**Actions**:
1. Run plugin-validator agent
2. Fix critical issues from validation
3. Review with skill-reviewer (if plugin has skills)
4. Test agent triggering (if plugin has agents)
5. Test hook configuration (if plugin has hooks)
6. Present findings and ask user about fixing issues

**Output**: Plugin validated and ready for testing

---

## Phase 7: Testing & Verification

**Goal**: Test that plugin works correctly in Claude Code

**Actions**:
1. Show installation instructions for local testing
2. Provide verification checklist for user
3. Give testing recommendations for each component type
4. Ask user if they want guided testing or self-testing
5. Walk through testing if requested

**Output**: Plugin tested and verified working

---

## Phase 8: Documentation & Next Steps

**Goal**: Ensure plugin is well-documented and ready for distribution

**Actions**:
1. Verify README completeness
2. Add marketplace entry (if publishing)
3. Create summary of what was created
4. Suggest improvements (optional)

**Output**: Complete, documented plugin ready for use or publication

---

## Important Notes

### Throughout All Phases

- Use TodoWrite to track progress at every phase
- Load skills with Skill tool when working on specific component types
- Use specialized agents (agent-creator, plugin-validator, skill-reviewer)
- Ask for user confirmation at key decision points
- Follow plugin-dev's own patterns as reference examples
- Apply best practices:
  - Third-person descriptions for skills
  - Imperative form in skill bodies
  - Commands written FOR Claude
  - Strong trigger phrases
  - ${CLAUDE_PLUGIN_ROOT} for portability
  - Progressive disclosure
  - Security-first (HTTPS, no hardcoded credentials)

### Key Decision Points (Wait for User)

1. After Phase 1: Confirm plugin purpose
2. After Phase 2: Approve component plan
3. After Phase 3: Proceed to implementation
4. After Phase 6: Fix issues or proceed
5. After Phase 7: Continue to documentation

### Quality Standards

Every component must meet these standards:
- Follows plugin-dev's proven patterns
- Uses correct naming conventions
- Has strong trigger conditions (skills/agents)
- Includes working examples
- Properly documented
- Validated with utilities
- Tested in Claude Code

---

**Begin with Phase 1: Discovery**
