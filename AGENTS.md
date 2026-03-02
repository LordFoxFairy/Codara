## Workflow Orchestration

### 1. Plan Node Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One tack per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management
1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles
- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Project-Specific Reminder
- `.codara/skills/` are **Codara product/runtime skills for this project and its users**, not assistant-internal helper skills.
- Never confuse project skills with system-level assistant skills; design and maintain them as product extension units.


## Project Structure & Module Organization
- `src/`: runtime TypeScript source (current entrypoint: `src/index.ts`).
- `dist/`: compiled output from TypeScript build (`tsc`), generated only.
- `docs/`: architecture and subsystem documentation (`00-architecture-overview.md` through `09-terminal-ui.md`).
- `.codara/`: project-specific Codara configuration and local skills.
- Root configs: `package.json`, `tsconfig.json`, `eslint.config.mjs`, `.prettierrc`.

Keep executable code in `src/`, keep design/system rationale in `docs/`, and avoid committing generated artifacts unless explicitly required.

## Build, Test, and Development Commands
- `bun install`: install dependencies from `bun.lock`.
- `bun run dev`: run `src/index.ts` in watch mode for local development.
- `bun run build`: type-check and compile TypeScript to `dist/`.
- `bun run lint`: run ESLint on `src/`.
- `bun run lint:fix`: auto-fix lint issues where supported.
- `bun run format`: apply Prettier formatting to `src/`.

Run `lint` and `build` before opening a PR.

## Coding Style & Naming Conventions
- Language: TypeScript (`strict` mode enabled).
- Formatting: Prettier (`singleQuote: true`, `semi: true`, `tabWidth: 2`, `trailingComma: es5`).
- Linting: ESLint 9 + `typescript-eslint` + React/React Hooks rule sets.
- Naming:
  - files: lowercase kebab-case where practical (for docs), `index.ts` for module entrypoints.
  - identifiers: `camelCase` for variables/functions, `PascalCase` for types/classes/components.

## Testing Guidelines
There is currently no dedicated test framework configured in `package.json`.
- Minimum gate: `bun run lint` and `bun run build` must pass.
- When adding tests, place them alongside source (`*.test.ts`) or in a `tests/` directory and document the command in `package.json`.

## Commit & Pull Request Guidelines
- Follow Conventional Commit style seen in history, e.g.:
  - `feat(skills): add security-check skill`
  - `refactor(docs): reorganize skill documentation`
- Keep commits scoped and atomic.
- PRs should include:
  - concise summary of what changed and why,
  - affected paths/modules,
  - verification steps run (`bun run lint`, `bun run build`),
  - screenshots or terminal output when UI/CLI behavior changes.
