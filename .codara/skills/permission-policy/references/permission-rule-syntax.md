# Permission Rule Syntax

## Expression format
A rule is either:
- `Tool`
- `Tool(specifier)`

Examples:
- `Bash`
- `Bash(git status)`
- `Bash(git *)`
- `Read(./.env)`
- `WebFetch(domain:github.com)`
- `Task(Explore)`

## Matching
- Tool name matching is case-insensitive and supports wildcard `*`.
- Specifier matching supports exact match and wildcard `*`.
- Missing specifier in rule means "match all invocations of this tool".

## Decision order
Always evaluate buckets in this order:
1. `deny`
2. `ask`
3. `allow`

First matched rule in each bucket wins.
If nothing matches, use configured fallback decision.

## Compatibility note
Claude settings and native Codara policy files can both be normalized to this model.
