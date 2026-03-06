#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  upsert-permission-rule.sh "<Tool(...)>" [--bucket <allow|ask|deny>] [--project-root <path>] [--settings-file <path>]

Examples:
  upsert-permission-rule.sh "Bash(git status)"
  upsert-permission-rule.sh "Bash(git push)" --bucket ask
  upsert-permission-rule.sh "Read(.env)" --settings-file .codara/settings.local.json
USAGE
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

RULE="$1"
shift

BUCKET="allow"
PROJECT_ROOT="$(pwd)"
SETTINGS_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bucket)
      BUCKET="$2"
      shift 2
      ;;
    --project-root)
      PROJECT_ROOT="$2"
      shift 2
      ;;
    --settings-file)
      SETTINGS_FILE="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

bun -e '
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(1);
const rule = (args[0] ?? "").trim();
const bucket = (args[1] ?? "allow").trim();
const projectRoot = path.resolve(args[2] ?? process.cwd());
const explicitSettingsFile = (args[3] ?? "").trim();

if (!rule) {
  console.error("Permission rule is required");
  process.exit(1);
}

if (!["allow", "ask", "deny"].includes(bucket)) {
  console.error(`Unsupported bucket: ${bucket}`);
  process.exit(1);
}

const settingsFile = explicitSettingsFile
  ? path.resolve(explicitSettingsFile)
  : path.join(projectRoot, ".codara", "settings.local.json");

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeRules(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === "string");
}

let root = {};
let created = true;

if (fs.existsSync(settingsFile)) {
  created = false;
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    if (!isRecord(parsed)) {
      throw new Error("settings file must contain a JSON object");
    }
    root = parsed;
  } catch (error) {
    console.error(`Invalid JSON in ${settingsFile}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

const rootRecord = isRecord(root) ? root : {};
const permissions = isRecord(rootRecord.permissions) ? {...rootRecord.permissions} : {};
const rules = isRecord(permissions.rules) ? {...permissions.rules} : {};
const bucketRules = normalizeRules(rules[bucket]);
const alreadyPresent = bucketRules.includes(rule);

if (!alreadyPresent) {
  bucketRules.push(rule);
}

rules[bucket] = bucketRules;
permissions.rules = rules;
rootRecord.permissions = permissions;

fs.mkdirSync(path.dirname(settingsFile), {recursive: true});
fs.writeFileSync(settingsFile, `${JSON.stringify(rootRecord, null, 2)}\n`);

process.stdout.write(JSON.stringify({
  settingsFile,
  bucket,
  rule,
  created,
  alreadyPresent,
}) + "\n");
' "$RULE" "$BUCKET" "$PROJECT_ROOT" "$SETTINGS_FILE"
