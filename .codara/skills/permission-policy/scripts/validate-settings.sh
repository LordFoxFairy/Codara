#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  validate-settings.sh [--profile <codara|claude|auto>] [--project-root <path>] [--managed <path>] [--policy-file <path> ...] [settings-file ...]

Examples:
  validate-settings.sh --profile codara
  validate-settings.sh .codara/settings.json
  validate-settings.sh --profile claude .claude/settings.local.json
USAGE
}

PROFILE="auto"
PROJECT_ROOT="$(pwd)"
MANAGED_PATH="${CLAUDE_MANAGED_SETTINGS_PATH:-}"
POLICY_FILES=()
TARGETS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --project-root)
      PROJECT_ROOT="$2"
      shift 2
      ;;
    --managed)
      MANAGED_PATH="$2"
      shift 2
      ;;
    --policy-file)
      POLICY_FILES+=("$2")
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      TARGETS+=("$1")
      shift
      ;;
  esac
done

POLICY_FILE_LINES=""
if (( ${#POLICY_FILES[@]} > 0 )); then
  POLICY_FILE_LINES="$(printf '%s\n' "${POLICY_FILES[@]}")"
fi

TARGET_LINES=""
if (( ${#TARGETS[@]} > 0 )); then
  TARGET_LINES="$(printf '%s\n' "${TARGETS[@]}")"
fi

bun -e '
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(1);
const profile = (args[0] ?? "auto").trim().toLowerCase();
const projectRoot = path.resolve(args[1] ?? process.cwd());
const managedPathArg = (args[2] ?? "").trim();
const policyFiles = (args[3] ?? "").split("\n").filter(Boolean).map((item) => path.resolve(item));
const explicitTargets = (args[4] ?? "").split("\n").filter(Boolean).map((item) => path.resolve(item));

if (!["auto", "codara", "claude"].includes(profile)) {
  console.error(`Unsupported profile: ${profile}`);
  process.exit(1);
}

function print(message) {
  process.stdout.write(`${message}\n`);
}

function normalizeRules(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => typeof item === "string");
}

function parsePolicyData(parsed) {
  const permissions = parsed?.permissions;
  if (permissions && typeof permissions === "object" && !Array.isArray(permissions)) {
    const nestedRules = permissions.rules;
    if (nestedRules && typeof nestedRules === "object" && !Array.isArray(nestedRules)) {
      return {
        format: "codara_settings",
        allow: normalizeRules(nestedRules.allow),
        ask: normalizeRules(nestedRules.ask),
        deny: normalizeRules(nestedRules.deny),
        defaultField: permissions.defaultDecision,
        errors: ["allow", "ask", "deny"].flatMap((key) => {
          const value = nestedRules[key];
          if (value == null || Array.isArray(value)) {
            return [];
          }
          return [`permissions.rules.${key} must be string[]`];
        }),
      };
    }

    return {
      format: "claude",
      allow: normalizeRules(permissions.allow),
      ask: normalizeRules(permissions.ask),
      deny: normalizeRules(permissions.deny),
      defaultField: permissions.defaultMode,
      errors: ["allow", "ask", "deny"].flatMap((key) => {
        const value = permissions[key];
        if (value == null || Array.isArray(value)) {
          return [];
        }
        return [`permissions.${key} must be string[]`];
      }),
    };
  }

  const rules = parsed?.rules;
  if (rules && typeof rules === "object" && !Array.isArray(rules)) {
    return {
      format: "codara",
      allow: normalizeRules(rules.allow),
      ask: normalizeRules(rules.ask),
      deny: normalizeRules(rules.deny),
      defaultField: parsed.defaultDecision,
      errors: ["allow", "ask", "deny"].flatMap((key) => {
        const value = rules[key];
        if (value == null || Array.isArray(value)) {
          return [];
        }
        return [`rules.${key} must be string[]`];
      }),
    };
  }

  const rootAllow = parsed?.allow;
  const rootAsk = parsed?.ask;
  const rootDeny = parsed?.deny;
  const hasRoot = rootAllow != null || rootAsk != null || rootDeny != null;
  if (hasRoot) {
    return {
      format: "root",
      allow: normalizeRules(rootAllow),
      ask: normalizeRules(rootAsk),
      deny: normalizeRules(rootDeny),
      defaultField: parsed.defaultDecision ?? parsed.defaultMode,
      errors: ["allow", "ask", "deny"].flatMap((key) => {
        const value = parsed?.[key];
        if (value == null || Array.isArray(value)) {
          return [];
        }
        return [`${key} must be string[]`];
      }),
    };
  }

  return {
    format: "unknown",
    allow: [],
    ask: [],
    deny: [],
    defaultField: undefined,
    errors: [],
  };
}

function getManagedCandidates() {
  const candidates = [];
  if (managedPathArg) {
    candidates.push(path.resolve(managedPathArg));
  }

  if (process.platform === "darwin") {
    candidates.push("/Library/Application Support/ClaudeCode/managed-settings.json");
  } else if (process.platform === "linux") {
    candidates.push("/etc/claude-code/managed-settings.json");
  } else if (process.platform === "win32") {
    candidates.push("C:\\Program Files\\ClaudeCode\\managed-settings.json");
  }

  const seen = new Set();
  const deduped = [];
  for (const item of candidates) {
    const resolved = path.resolve(item);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    deduped.push(resolved);
  }

  return deduped;
}

function profileTargets() {
  if (explicitTargets.length > 0) {
    return explicitTargets;
  }

  const targets = [...policyFiles];

  if (profile === "codara" || profile === "auto") {
    targets.push(
      path.join(projectRoot, ".codara", "settings.local.json"),
      path.join(projectRoot, ".codara", "settings.json"),
      path.join(os.homedir(), ".codara", "settings.json"),
    );
  }

  if (profile === "claude" || profile === "auto") {
    for (const managedCandidate of getManagedCandidates()) {
      if (fs.existsSync(managedCandidate)) {
        targets.push(managedCandidate);
        break;
      }
    }

    targets.push(
      path.join(projectRoot, ".claude", "settings.local.json"),
      path.join(projectRoot, ".claude", "settings.json"),
      path.join(os.homedir(), ".claude", "settings.json"),
    );
  }

  const seen = new Set();
  const deduped = [];
  for (const item of targets) {
    const resolved = path.resolve(item);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    deduped.push(resolved);
  }

  return deduped;
}

const targets = profileTargets();
if (targets.length === 0) {
  console.error("No settings files selected");
  process.exit(1);
}

let failed = false;

for (const filePath of targets) {
  if (!fs.existsSync(filePath)) {
    print(`SKIP ${filePath} (not found)`);
    continue;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    print(`FAIL ${filePath} invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
    continue;
  }

  const policy = parsePolicyData(parsed);
  if (policy.format === "unknown") {
    print(`WARN ${filePath} no recognized policy shape`);
    continue;
  }

  for (const error of policy.errors) {
    print(`FAIL ${filePath} ${error}`);
    failed = true;
  }

  if (policy.defaultField != null && typeof policy.defaultField !== "string") {
    print(`FAIL ${filePath} default decision field must be string`);
    failed = true;
  }

  print(`OK   ${filePath} format=${policy.format} allow=${policy.allow.length} ask=${policy.ask.length} deny=${policy.deny.length}`);
}

if (failed) {
  process.exit(2);
}
' -- "$PROFILE" "$PROJECT_ROOT" "$MANAGED_PATH" "$POLICY_FILE_LINES" "$TARGET_LINES"
