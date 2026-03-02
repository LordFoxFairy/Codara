#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="${ROOT_DIR}/.codara/skills"
DOCS_DIR="${ROOT_DIR}/docs"

errors=0
warnings=0
skills_checked=0
json_checked=0
shell_checked=0
links_checked=0

error() {
  echo "ERROR: $*"
  errors=$((errors + 1))
}

warn() {
  echo "WARN: $*"
  warnings=$((warnings + 1))
}

check_required_tools() {
  local cmd
  for cmd in jq rg awk find bash; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      error "Required command not found: $cmd"
    fi
  done
}

validate_frontmatter() {
  local skill_dir="$1"
  local skill_name="$2"
  local skill_md="${skill_dir}/SKILL.md"
  local frontmatter

  if [ ! -f "$skill_md" ]; then
    error "Missing SKILL.md in ${skill_dir}"
    return
  fi

  if [ "$(head -n 1 "$skill_md")" != "---" ]; then
    error "SKILL.md must start with YAML frontmatter marker (---): ${skill_md}"
    return
  fi

  frontmatter="$(awk '
    NR == 1 && $0 == "---" { in_frontmatter = 1; next }
    in_frontmatter && $0 == "---" { exit }
    in_frontmatter { print }
  ' "$skill_md")"

  if [ -z "$frontmatter" ]; then
    error "Empty or malformed frontmatter in ${skill_md}"
    return
  fi

  if ! printf '%s\n' "$frontmatter" | rg -q '^[[:space:]]*name:[[:space:]]*[^[:space:]].*$'; then
    error "Missing required frontmatter field 'name' in ${skill_md}"
  fi

  if ! printf '%s\n' "$frontmatter" | rg -q '^[[:space:]]*description:[[:space:]]*[^[:space:]].*$'; then
    error "Missing required frontmatter field 'description' in ${skill_md}"
  fi

  if [ "${VALIDATE_SKILLS_WARN_LEGACY:-0}" = "1" ] && \
    printf '%s\n' "$frontmatter" | rg -q '^[[:space:]]*command-name:[[:space:]]*'; then
    warn "Legacy field 'command-name' present in ${skill_md}"
  fi

  if [ "$skill_name" != "$(printf '%s' "$skill_name" | tr '[:upper:]' '[:lower:]')" ]; then
    error "Skill directory name must be lowercase: ${skill_name}"
  fi

  if ! printf '%s\n' "$skill_name" | rg -q '^[a-z0-9][a-z0-9-]*$'; then
    error "Skill directory name must match [a-z0-9-]+: ${skill_name}"
  fi
}

validate_json_files() {
  local scope_dir="$1"
  local json_file

  while IFS= read -r json_file; do
    json_checked=$((json_checked + 1))
    if ! jq empty "$json_file" >/dev/null 2>&1; then
      error "Invalid JSON: ${json_file}"
    fi
  done < <(find "$scope_dir" -type f -name '*.json' | sort)
}

validate_shell_scripts() {
  local skill_dir="$1"
  local script_file

  if [ ! -d "${skill_dir}/scripts" ]; then
    return
  fi

  while IFS= read -r script_file; do
    shell_checked=$((shell_checked + 1))
    if ! bash -n "$script_file"; then
      error "Shell syntax error: ${script_file}"
    fi
  done < <(find "${skill_dir}/scripts" -type f -name '*.sh' | sort)
}

validate_markdown_links_in_dir() {
  local scope_dir="$1"
  local md_file
  local link
  local target
  local base_dir

  while IFS= read -r md_file; do
    while IFS= read -r link; do
      links_checked=$((links_checked + 1))
      target="${link#*](}"
      target="${target%)}"
      target="${target%%#*}"

      case "$target" in
        ""|http*|mailto:*|/*)
          continue
          ;;
      esac

      base_dir="$(dirname "$md_file")"
      if [ ! -e "${base_dir}/${target}" ]; then
        error "Broken relative link in ${md_file}: ${target}"
      fi
    done < <(rg -o '\]\([^)]*\)' "$md_file")
  done < <(find "$scope_dir" -type f -name '*.md' | sort)
}

main() {
  check_required_tools
  if [ "$errors" -gt 0 ]; then
    echo "Validation aborted due to missing prerequisites."
    exit 1
  fi

  if [ ! -d "$SKILLS_DIR" ]; then
    error "Skills directory not found: ${SKILLS_DIR}"
    exit 1
  fi

  local skill_dir
  local skill_name
  while IFS= read -r skill_dir; do
    skills_checked=$((skills_checked + 1))
    skill_name="$(basename "$skill_dir")"
    validate_frontmatter "$skill_dir" "$skill_name"
    validate_json_files "$skill_dir"
    validate_shell_scripts "$skill_dir"
    validate_markdown_links_in_dir "$skill_dir"
  done < <(find "$SKILLS_DIR" -mindepth 1 -maxdepth 1 -type d | sort)

  if [ -d "$DOCS_DIR" ]; then
    validate_markdown_links_in_dir "$DOCS_DIR"
  fi

  echo ""
  echo "Skills validation summary:"
  echo "  skills checked: ${skills_checked}"
  echo "  JSON files checked: ${json_checked}"
  echo "  shell scripts checked: ${shell_checked}"
  echo "  markdown links checked: ${links_checked}"
  echo "  warnings: ${warnings}"
  echo "  errors: ${errors}"

  if [ "$errors" -gt 0 ]; then
    exit 1
  fi
}

main "$@"
