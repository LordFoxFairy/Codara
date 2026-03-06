# Policy Sources

## Native profile: `codara`
High to low precedence:
1. `.codara/settings.local.json`
2. `.codara/settings.json`
3. `~/.codara/settings.json`

Recommended for any runtime/terminal that is not tied to Claude settings.

## Compatibility profile: `claude`
High to low precedence:
1. Managed settings file (platform path)
2. `.claude/settings.local.json`
3. `.claude/settings.json`
4. `~/.claude/settings.json`

This profile reads `permissions` object from each settings file.

## Mixed profile: `auto`
- Resolve `codara` then `claude` sources.
- Use for transition periods or mixed toolchains.

## Explicit override files
You can prepend ad-hoc files with `--policy-file <path>`.
These files are loaded before profile defaults.
