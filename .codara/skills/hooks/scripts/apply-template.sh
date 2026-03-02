#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: $0 <template-name> [target-settings-file]" >&2
  echo "Templates: security-check, audit-logger, sandbox-redirect" >&2
  exit 1
fi

TEMPLATE_NAME="$1"
TARGET_FILE="${2:-settings.local.json}"
SKILL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_FILE="${SKILL_ROOT}/templates/${TEMPLATE_NAME}.json"

if [ ! -f "$TEMPLATE_FILE" ]; then
  echo "Unknown template: $TEMPLATE_NAME" >&2
  echo "Available templates: security-check, audit-logger, sandbox-redirect" >&2
  exit 1
fi

if [ ! -f "$TARGET_FILE" ]; then
  printf '{}\n' > "$TARGET_FILE"
fi

jq empty "$TARGET_FILE" >/dev/null
jq empty "$TEMPLATE_FILE" >/dev/null

TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/codara-hooks-merge.XXXXXX")"

jq -s '
  def merge_hooks(base; tpl):
    (base // {}) as $b
    | (tpl // {}) as $t
    | if (($b | length) + ($t | length)) == 0 then
        null
      else
        reduce ((($b | keys_unsorted) + ($t | keys_unsorted) | unique)[]) as $key
          ({};
            .[$key] = (($b[$key] // []) + ($t[$key] // []))
          )
      end;

  .[0] as $base
  | .[1] as $tpl
  | $base
  | (merge_hooks($base.hooks; $tpl.hooks)) as $merged_hooks
  | if $merged_hooks == null then
      del(.hooks)
    else
      .hooks = $merged_hooks
    end
  | (($base.permissions // {}) * ($tpl.permissions // {})) as $merged_permissions
  | if ($merged_permissions | length) == 0 then
      del(.permissions)
    else
      .permissions = $merged_permissions
    end
' "$TARGET_FILE" "$TEMPLATE_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$TARGET_FILE"

echo "Applied '${TEMPLATE_NAME}' to ${TARGET_FILE}"
echo "Current hooks summary:"
jq '.hooks // {}' "$TARGET_FILE"
