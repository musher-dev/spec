#!/usr/bin/env bash
# env-check.sh — Library: compare a local .env against its template.
#
# This is a library file meant to be sourced, not executed directly.
# Usage: source "path/to/env-check.sh"
#
# Exposes:
#   env_check_keys <file>                — print KEY names (one per line) to stdout
#   env_check_drift <env> <example>      — print missing keys; non-zero if any drift
#   env_check_required <env>             — print keys with empty values to stdout
set -euo pipefail

# Extracts variable names from a dotenv-style file.
#
# Recognizes lines that start with an uppercase identifier followed by '='.
# Skips blanks, comments (`#`), and commented-out overrides.
#
# Arguments:
#   $1 — path to env file
# Outputs:
#   One KEY per line on stdout (deduplicated, in file order)
env_check_keys() {
  local file="${1:?usage: env_check_keys <file>}"
  [[ -f "${file}" ]] || return 0
  grep -E '^[A-Z_][A-Z0-9_]*=' "${file}" | sed 's/=.*//' | awk '!seen[$0]++'
}

# Reports keys present in <example> but missing from <env>.
#
# Arguments:
#   $1 — path to .env (the user's local file)
#   $2 — path to .env.example (the template)
# Outputs:
#   Missing keys, one per line, to stderr
# Returns:
#   0 if no drift, 1 if any keys are missing
env_check_drift() {
  local env_file="${1:?usage: env_check_drift <env> <example>}"
  local example_file="${2:?}"
  [[ -f "${example_file}" ]] || return 0

  local expected actual missing
  expected="$(env_check_keys "${example_file}" | sort -u)"
  actual="$(env_check_keys "${env_file}" | sort -u)"
  missing="$(comm -23 <(echo "${expected}") <(echo "${actual}"))"

  if [[ -n "${missing}" ]]; then
    echo "${missing}" >&2
    return 1
  fi
  return 0
}

# Reports keys present in <env> whose value is empty (the "required, please
# fill in" state from the three-state grammar).
#
# Arguments:
#   $1 — path to .env
# Outputs:
#   Empty-valued keys, one per line, to stdout
# Returns:
#   0 always (informational)
env_check_required() {
  local env_file="${1:?usage: env_check_required <env>}"
  [[ -f "${env_file}" ]] || return 0
  grep -E '^[A-Z_][A-Z0-9_]*=$' "${env_file}" | sed 's/=$//' || true
}
