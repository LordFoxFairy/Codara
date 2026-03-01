# Codara Project Instructions

## Language
- Code comments and variable names in English
- Commit messages in Chinese, format: `type(scope): description`

## Code Standards
- TypeScript strict mode, no `any`
- ESM only (import/export), no CommonJS
- Prefer functions over classes unless state management is needed
- Error handling uses Result pattern, avoid try-catch sprawl

## Architecture
- Tool definitions in `src/tools/definitions/`
- Middleware in `src/middleware/`
- All model routing via config.json, never hardcode model IDs
- All extensions are skills, not hardcoded features

## Testing
- Vitest
- Test files colocated with source: `*.test.ts`
- Critical paths must have unit tests
