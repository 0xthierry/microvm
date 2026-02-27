#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${HOME}/.local/bin"
BIN_NAME="microvm"
BIN_SOURCE="${PROJECT_ROOT}/dist/${BIN_NAME}"
BIN_TARGET="${INSTALL_DIR}/${BIN_NAME}"

mkdir -p "${HOME}"
export BUN_INSTALL="${BUN_INSTALL:-${HOME}/.bun}"
export BUN_TMPDIR="${BUN_TMPDIR:-${TMPDIR:-/tmp}}"
mkdir -p "${BUN_INSTALL}" "${BUN_TMPDIR}"

echo "[microvm] Installing dependencies..."
cd "${PROJECT_ROOT}"
bun install

echo "[microvm] Running doctor checks..."
if ! bun src/index.ts doctor; then
  echo "[microvm] Doctor checks failed. Resolve missing requirements, then re-run bun run install:cli."
  exit 1
fi

echo "[microvm] Building standalone binary..."
bun run build:binary

echo "[microvm] Installing binary into ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"
install -m 0755 "${BIN_SOURCE}" "${BIN_TARGET}"

echo "[microvm] Installed: ${BIN_TARGET}"
if [[ ":${PATH}:" == *":${INSTALL_DIR}:"* ]]; then
  if command -v microvm >/dev/null 2>&1; then
    RESOLVED_PATH="$(command -v microvm)"
    echo "[microvm] Resolved on PATH: ${RESOLVED_PATH}"
    if [[ "${RESOLVED_PATH}" != "${BIN_TARGET}" ]]; then
      echo "[microvm] Warning: another microvm binary appears earlier on PATH."
    fi
  fi
else
  echo "[microvm] ~/.local/bin is not on your PATH."
  echo "[microvm] Add this to your shell profile, then open a new shell:"
  echo "export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
