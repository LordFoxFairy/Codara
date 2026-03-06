#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  evaluate-permission.sh "<Tool(...)>" [--profile <codara|claude|auto>] [--project-root <path>] [--managed <path>] [--policy-file <path> ...]

Examples:
  evaluate-permission.sh "Bash(git status)"
  evaluate-permission.sh "Read(./.env)" --profile codara
  evaluate-permission.sh "Bash(npm run test)" --policy-file ./tmp/policy.json
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

TOOL_CALL="$1"
shift

PROFILE="auto"
PROJECT_ROOT="$(pwd)"
MANAGED_PATH="${CLAUDE_MANAGED_SETTINGS_PATH:-}"
POLICY_FILES=()

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
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

POLICY_FILE_LINES=""
if (( ${#POLICY_FILES[@]} > 0 )); then
  POLICY_FILE_LINES="$(printf '%s\n' "${POLICY_FILES[@]}")"
fi

bun -e '
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(1);
const toolCallRaw = (args[0] ?? "").trim();
const profile = (args[1] ?? "auto").trim().toLowerCase();
const projectRoot = path.resolve(args[2] ?? process.cwd());
const managedPathArg = (args[3] ?? "").trim();
const policyFiles = (args[4] ?? "").split("\n").filter(Boolean).map((item) => path.resolve(item));

if (!toolCallRaw) {
  console.error("Tool expression is required");
  process.exit(1);
}

if (!["auto", "codara", "claude"].includes(profile)) {
  console.error(`Unsupported profile: ${profile}`);
  process.exit(1);
}

function parseToolExpression(input) {
  const text = input.trim();
  const openIndex = text.indexOf("(");

  if (openIndex < 0) {
    return {tool: text, specifier: null};
  }

  if (!text.endsWith(")")) {
    throw new Error(`Invalid tool expression: ${input}`);
  }

  const tool = text.slice(0, openIndex).trim();
  const specifier = text.slice(openIndex + 1, -1);
  return {tool, specifier};
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(pattern, caseInsensitive = false) {
  const escaped = escapeRegExp(pattern).replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`, caseInsensitive ? "i" : "");
}

function toolMatches(callTool, ruleTool) {
  const regex = globToRegExp(ruleTool, true);
  return regex.test(callTool);
}

function specifierMatches(callSpecifier, ruleSpecifier) {
  if (ruleSpecifier == null) {
    return true;
  }
  if (callSpecifier == null) {
    return false;
  }

  if (!ruleSpecifier.includes("*")) {
    return callSpecifier === ruleSpecifier;
  }

  const regex = globToRegExp(ruleSpecifier, false);
  return regex.test(callSpecifier);
}

function normalizeRules(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === "string");
}

function normalizeDefaultDecision(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (["allow", "ask", "deny"].includes(normalized)) {
    return normalized;
  }

  if (normalized === "bypassPermissions") {
    return "allow";
  }
  if (normalized === "dontAsk") {
    return "deny";
  }

  return "ask";
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
        defaultDecision: normalizeDefaultDecision(permissions.defaultDecision),
      };
    }

    return {
      format: "claude",
      allow: normalizeRules(permissions.allow),
      ask: normalizeRules(permissions.ask),
      deny: normalizeRules(permissions.deny),
      defaultDecision: normalizeDefaultDecision(permissions.defaultMode),
    };
  }

  const rules = parsed?.rules;
  if (rules && typeof rules === "object" && !Array.isArray(rules)) {
    return {
      format: "codara",
      allow: normalizeRules(rules.allow),
      ask: normalizeRules(rules.ask),
      deny: normalizeRules(rules.deny),
      defaultDecision: normalizeDefaultDecision(parsed.defaultDecision),
    };
  }

  const rootAllow = normalizeRules(parsed?.allow);
  const rootAsk = normalizeRules(parsed?.ask);
  const rootDeny = normalizeRules(parsed?.deny);
  const hasRootRules = rootAllow.length > 0 || rootAsk.length > 0 || rootDeny.length > 0;
  if (hasRootRules) {
    return {
      format: "root",
      allow: rootAllow,
      ask: rootAsk,
      deny: rootDeny,
      defaultDecision: normalizeDefaultDecision(parsed?.defaultDecision ?? parsed?.defaultMode),
    };
  }

  return {
    format: "unknown",
    allow: [],
    ask: [],
    deny: [],
    defaultDecision: null,
  };
}

function getManagedCandidates() {
  const candidates = [];
  if (managedPathArg) {
    candidates.push(managedPathArg);
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

function addCodaraSources(target) {
  target.push(
    {scope: "codara_local", path: path.join(projectRoot, ".codara", "settings.local.json")},
    {scope: "codara_project", path: path.join(projectRoot, ".codara", "settings.json")},
    {scope: "codara_user", path: path.join(os.homedir(), ".codara", "settings.json")},
  );
}

function addClaudeSources(target) {
  for (const managedCandidate of getManagedCandidates()) {
    if (fs.existsSync(managedCandidate)) {
      target.push({scope: "claude_managed", path: managedCandidate});
      break;
    }
  }

  target.push(
    {scope: "claude_local", path: path.join(projectRoot, ".claude", "settings.local.json")},
    {scope: "claude_project", path: path.join(projectRoot, ".claude", "settings.json")},
    {scope: "claude_user", path: path.join(os.homedir(), ".claude", "settings.json")},
  );
}

function buildSourceList() {
  const list = [];

  for (const policyFile of policyFiles) {
    list.push({scope: "explicit", path: policyFile});
  }

  if (profile === "codara") {
    addCodaraSources(list);
  } else if (profile === "claude") {
    addClaudeSources(list);
  } else {
    addCodaraSources(list);
    addClaudeSources(list);
  }

  const seen = new Set();
  const deduped = [];
  for (const item of list) {
    const resolvedPath = path.resolve(item.path);
    if (seen.has(resolvedPath)) {
      continue;
    }
    seen.add(resolvedPath);
    deduped.push({scope: item.scope, path: resolvedPath});
  }

  return deduped;
}

function loadSource(source) {
  if (!fs.existsSync(source.path)) {
    return {
      scope: source.scope,
      path: source.path,
      exists: false,
      format: null,
      policy: null,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(source.path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${source.path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const policy = parsePolicyData(parsed);

  return {
    scope: source.scope,
    path: source.path,
    exists: true,
    format: policy.format,
    policy,
  };
}

const call = parseToolExpression(toolCallRaw);
if (!call.tool) {
  throw new Error(`Invalid tool expression: ${toolCallRaw}`);
}

const sourceList = buildSourceList();
const sources = sourceList.map(loadSource);
const loadedSources = sources.filter((item) => item.exists && item.policy != null);

const mergedPolicy = {
  defaultDecision: null,
  deny: [],
  ask: [],
  allow: [],
};

for (const source of loadedSources) {
  const policy = source.policy;
  if (!policy) {
    continue;
  }

  if (mergedPolicy.defaultDecision == null && policy.defaultDecision) {
    mergedPolicy.defaultDecision = policy.defaultDecision;
  }

  for (const rule of policy.deny) {
    mergedPolicy.deny.push({rule, scope: source.scope, path: source.path, format: source.format});
  }
  for (const rule of policy.ask) {
    mergedPolicy.ask.push({rule, scope: source.scope, path: source.path, format: source.format});
  }
  for (const rule of policy.allow) {
    mergedPolicy.allow.push({rule, scope: source.scope, path: source.path, format: source.format});
  }
}

function findMatch(rules) {
  for (const entry of rules) {
    const parsedRule = parseToolExpression(entry.rule);
    if (!parsedRule.tool) {
      continue;
    }

    if (!toolMatches(call.tool, parsedRule.tool)) {
      continue;
    }

    if (!specifierMatches(call.specifier, parsedRule.specifier)) {
      continue;
    }

    return entry;
  }

  return null;
}

const matchedDeny = findMatch(mergedPolicy.deny);
const matchedAsk = matchedDeny ? null : findMatch(mergedPolicy.ask);
const matchedAllow = matchedDeny || matchedAsk ? null : findMatch(mergedPolicy.allow);

let decision = mergedPolicy.defaultDecision ?? "ask";
let matched = null;

if (matchedDeny) {
  decision = "deny";
  matched = {bucket: "deny", ...matchedDeny};
} else if (matchedAsk) {
  decision = "ask";
  matched = {bucket: "ask", ...matchedAsk};
} else if (matchedAllow) {
  decision = "allow";
  matched = {bucket: "allow", ...matchedAllow};
}

console.log(JSON.stringify({
  input: toolCallRaw,
  profile,
  decision,
  matched,
  defaultDecision: mergedPolicy.defaultDecision ?? "ask",
  sources: sources.map((item) => ({
    scope: item.scope,
    path: item.path,
    exists: item.exists,
    format: item.format,
  })),
  policySummary: {
    deny: mergedPolicy.deny.length,
    ask: mergedPolicy.ask.length,
    allow: mergedPolicy.allow.length,
  },
}, null, 2));
' -- "$TOOL_CALL" "$PROFILE" "$PROJECT_ROOT" "$MANAGED_PATH" "$POLICY_FILE_LINES"
