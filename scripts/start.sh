#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export MICROVM_HOME="${MICROVM_HOME:-${PROJECT_ROOT}/.microvm}"

cd "${PROJECT_ROOT}"
bun src/index.ts "$@"
