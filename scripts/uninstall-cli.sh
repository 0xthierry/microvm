#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${HOME}/.local/bin"
BIN_NAME="microvm"
BIN_TARGET="${INSTALL_DIR}/${BIN_NAME}"

log() {
  echo "[microvm] $*"
}

run_cli() {
  # Prefer source entrypoint so uninstall behavior matches this checkout.
  if command -v bun >/dev/null 2>&1 && [[ -f "${PROJECT_ROOT}/src/index.ts" ]]; then
    if bun "${PROJECT_ROOT}/src/index.ts" "$@"; then
      return 0
    fi
  fi

  if [[ -x "${BIN_TARGET}" ]]; then
    if "${BIN_TARGET}" "$@"; then
      return 0
    fi
  fi

  if command -v microvm >/dev/null 2>&1; then
    if "$(command -v microvm)" "$@"; then
      return 0
    fi
  fi

  log "Unable to run a microvm CLI command. VMs were not cleaned up."
  return 1
}

is_safe_cleanup_path() {
  local path="$1"
  [[ -n "${path}" ]] || return 1
  [[ "${path}" = /* ]] || return 1
  [[ "${path}" != "/" && "${path}" != "${HOME}" ]] || return 1

  case "${path}" in
  */microvm | */microvm/* | */.microvm | */.microvm/*)
    return 0
    ;;
  *)
    return 1
    ;;
  esac
}

cleanup_vms() {
  local list_output
  if ! list_output="$(run_cli list)"; then
    return 1
  fi

  local vm_ids=()
  mapfile -t vm_ids < <(
    printf '%s\n' "${list_output}" \
      | sed -n 's/^[[:space:]]*"id":[[:space:]]*"\([^"]*\)",\?/\1/p'
  )

  if [[ "${#vm_ids[@]}" -eq 0 ]]; then
    log "No VMs to delete."
    return 0
  fi

  log "Deleting ${#vm_ids[@]} VM(s)..."

  local failed=0
  local vm_id
  for vm_id in "${vm_ids[@]}"; do
    if ! run_cli delete "${vm_id}"; then
      log "Failed to delete VM \"${vm_id}\"."
      failed=1
    fi
  done

  if [[ "${failed}" -ne 0 ]]; then
    log "Aborting uninstall because one or more VMs failed to delete."
    return 1
  fi

  return 0
}

cleanup_state_paths() {
  local cleanup_paths=()
  local failed=0

  if command -v bun >/dev/null 2>&1 && [[ -f "${PROJECT_ROOT}/src/config/paths.ts" ]]; then
    mapfile -t cleanup_paths < <(
      cd "${PROJECT_ROOT}"
      bun --eval 'import { buildRuntimePaths } from "./src/config/paths";
const paths = buildRuntimePaths({
  projectRoot: process.cwd(),
  env: {
    MICROVM_HOME: process.env.MICROVM_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    HOME: process.env.HOME,
  },
});
const candidates = [
  paths.vmsDir,
  paths.vmDatabaseFile,
  `${paths.vmDatabaseFile}.lock`,
  paths.runtimeDir,
  paths.jailerBaseDir,
  paths.dataDir,
  paths.stateDir,
  paths.cacheDir,
];
for (const path of new Set(candidates)) {
  if (path) console.log(path);
}'
    )
  fi

  if [[ "${#cleanup_paths[@]}" -eq 0 ]]; then
    cleanup_paths=(
      "${HOME}/.local/share/microvm"
      "${HOME}/.local/state/microvm"
      "${HOME}/.cache/microvm"
      "${PROJECT_ROOT}/.microvm"
    )
  fi

  local path
  local -A seen=()
  for path in "${cleanup_paths[@]}"; do
    [[ -z "${path}" ]] && continue
    [[ -n "${seen[${path}]:-}" ]] && continue
    seen["${path}"]=1

    if ! is_safe_cleanup_path "${path}"; then
      log "Skipping potentially unsafe cleanup path: ${path}"
      continue
    fi

    if [[ -e "${path}" || -L "${path}" ]]; then
      if rm -rf -- "${path}" 2>/dev/null; then
        log "Removed: ${path}"
        continue
      fi

      if command -v sudo >/dev/null 2>&1 && sudo rm -rf -- "${path}"; then
        log "Removed with sudo: ${path}"
        continue
      fi

      log "Failed to remove path: ${path}"
      failed=1
    fi
  done

  if [[ "${failed}" -ne 0 ]]; then
    return 1
  fi

  return 0
}

cleanup_vms
cleanup_state_paths

if [[ -f "${BIN_TARGET}" ]]; then
  rm -f "${BIN_TARGET}"
  log "Removed: ${BIN_TARGET}"
else
  log "No installed binary found at ${BIN_TARGET}"
fi

if command -v microvm >/dev/null 2>&1; then
  RESOLVED_PATH="$(command -v microvm)"
  if [[ "${RESOLVED_PATH}" != "${BIN_TARGET}" ]]; then
    log "Another microvm binary is still on PATH: ${RESOLVED_PATH}"
  fi
fi
