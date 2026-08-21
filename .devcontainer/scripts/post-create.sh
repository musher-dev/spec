#!/usr/bin/env bash
# post-create.sh — DevContainer post-create command hook.
#
# Runs once after the container is created. Sets up environment files,
# invokes the base setup orchestrator, and configures shell customization.
#
# Usage: Called automatically by devcontainer.json postCreateCommand.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
# shellcheck source=lib/base-setup.sh
source "${SCRIPT_DIR}/lib/base-setup.sh"

# Logs the failing command and line number on ERR.
#
# Arguments:
#   $1 — line number
#   $2 — failed command string
# Outputs:
#   Writes error details to stderr via log()
on_error() {
  local line="${1}"
  local cmd="${2}"
  log "ERROR: command '${cmd}' failed at line ${line}"
}
trap 'on_error ${LINENO} "${BASH_COMMAND}"' ERR

# Installs lefthook git hooks for this repo. Best-effort: silently
# skips if lefthook isn't on PATH yet or no .config/lefthook.yml exists.
#
# Outputs:
#   Writes progress to stderr via log()
install_lefthook_hooks() {
  command -v lefthook >/dev/null 2>&1 || return 0
  [[ -f "${SCRIPT_DIR}/../../.config/lefthook.yml" ]] || return 0
  log "Installing lefthook git hooks..."
  (cd "${SCRIPT_DIR}/../.." && lefthook install >/dev/null 2>&1) || true
}

# Installs the specification tooling dependencies.
#
# tools/ carries its own package manifest so the normative tree stays free of
# any language affinity. Best-effort: a failure here leaves the container
# usable, and `task setup` recovers.
#
# Outputs:
#   Writes progress to stderr via log()
install_spec_tools() {
  command -v bun >/dev/null 2>&1 || return 0
  [[ -f "${SCRIPT_DIR}/../../tools/package.json" ]] || return 0
  log "Installing specification tooling (bun install)..."
  (cd "${SCRIPT_DIR}/../../tools" && bun install --frozen-lockfile) || {
    log "WARNING: bun install failed; run 'task setup' once the container is up"
    return 0
  }
}

# Entry point: runs the full post-create setup sequence.
#
# Arguments:
#   $@ — passed through (unused, reserved for future use)
# Outputs:
#   Writes progress to stderr via log()
main() {
  log "Starting post-create setup..."
  # base_setup reports a missing tool through its status rather than aborting,
  # so the repo-specific steps below still run. Carry the status to the exit
  # code so a half-provisioned container is still reported as one.
  local status=0
  base_setup || status=$?
  install_lefthook_hooks
  # --- Repo-specific setup ---
  install_spec_tools
  if ((status != 0)); then
    log "Post-create setup completed with MISSING TOOLS (see the ✗ lines above)"
    return "${status}"
  fi
  log "Post-create setup completed"
}

main "$@"
