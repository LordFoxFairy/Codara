# Scripts

## evaluate-permission.sh
Evaluate one tool expression and return normalized decision JSON.

```bash
./scripts/evaluate-permission.sh "Bash(git status)"
./scripts/evaluate-permission.sh "Read(./.env)" --profile codara
./scripts/evaluate-permission.sh "Bash(npm run test)" --policy-file ./tmp/policy.json
```

Options:
- `--profile codara|claude|auto` (default `auto`)
- `--project-root <path>`
- `--managed <path>` (managed settings override for Claude profile)
- `--policy-file <path>` (prepend explicit policy file; repeatable)

## validate-settings.sh
Validate policy/settings files for supported formats.

```bash
./scripts/validate-settings.sh --profile codara
./scripts/validate-settings.sh .codara/settings.json
./scripts/validate-settings.sh --profile claude .claude/settings.local.json
```

Supported formats:
- Codara settings: `permissions.defaultDecision` + `permissions.rules.{allow,ask,deny}`
- Codara generic override: `defaultDecision` + `rules.{allow,ask,deny}`
- Claude compatibility: `permissions.{allow,ask,deny,defaultMode}`
- Root fallback: `{allow,ask,deny}`

## upsert-permission-rule.sh
Persist one permission rule into `.codara/settings.local.json`.

```bash
./scripts/upsert-permission-rule.sh "Bash(git status)"
./scripts/upsert-permission-rule.sh "Bash(git push)" --bucket ask
```

Behavior:
- creates `.codara/settings.local.json` when missing
- writes into `permissions.rules.<bucket>`
- preserves unrelated settings keys
- deduplicates identical rules
