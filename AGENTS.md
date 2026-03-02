# Repository Guidelines

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
