#!/usr/bin/env bash
# initialize.sh — Host-side bootstrap for the dev container.
#
# Runs on the host (via devcontainer.json `initializeCommand`) BEFORE
# `docker run` is invoked. Because `runArgs --env-file` is evaluated at
# `docker run` time, the .env file must exist on the host before the
# container starts — that's why this work lives here, not in
# post-create.sh.
#
# Responsibilities:
#   * Create .devcontainer/.env from .env.example on first clone.
#   * Touch an empty .env if no example exists, so --env-file never hard-fails.
#   * Strip CRLF from .env (Windows/WSL safety — docker --env-file
#     rejects files with CRLF line endings).
#
# Idempotent: safe to run on every container start.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly DEVCONTAINER_DIR="${SCRIPT_DIR}/.."
readonly ENV_FILE="${DEVCONTAINER_DIR}/.env"
readonly ENV_EXAMPLE="${DEVCONTAINER_DIR}/.env.example"

log() {
  echo "[initialize] $*" >&2
}

ensure_env_file() {
  if [[ -f "${ENV_FILE}" ]]; then
    return 0
  fi
  if [[ -f "${ENV_EXAMPLE}" ]]; then
    log "Creating .devcontainer/.env from .env.example"
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
  else
    log "No .env.example found; creating empty .devcontainer/.env"
    : > "${ENV_FILE}"
  fi
}

# `perl -i`, not `sed -i`: this runs on the HOST, and BSD sed — every macOS
# host — reads the next argument as the backup suffix, so `sed -i 's/\r$//' f`
# consumes the expression and then treats f as the script. It exits non-zero,
# which under `set -e` would take the whole initializeCommand down with it.
# perl -i means the same thing on both host families.
strip_crlf() {
  [[ -f "${ENV_FILE}" ]] || return 0
  if grep -q $'\r' "${ENV_FILE}" 2>/dev/null; then
    log "Stripping CRLF from .devcontainer/.env"
    perl -i -pe 's/\r$//' "${ENV_FILE}"
  fi
}

main() {
  ensure_env_file
  strip_crlf
}

main "$@"
