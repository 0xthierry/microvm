#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if ! command -v microvm >/dev/null 2>&1; then
  echo "[example:archlinux] microvm is not on PATH." >&2
  echo "[example:archlinux] Install the CLI first, then rerun this script." >&2
  exit 1
fi

cd "${PROJECT_ROOT}"

microvm create \
  --name example-archlinux \
  --dockerfile examples/archlinux/Dockerfile \
  --cpus 2 \
  --memory-mib 2048 \
  --disk-gib 10
