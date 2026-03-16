#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if (( $# > 0 )); then
  echo "[run-all] positional arguments are not supported." >&2
  exit 2
fi

TESTS=(
  "$SCRIPT_DIR/cli/lifecycle.sh"
  "$SCRIPT_DIR/cli/docker-in-guest.sh"
  "$SCRIPT_DIR/cli/options.sh"
  "$SCRIPT_DIR/network/reachability.sh"
  "$SCRIPT_DIR/network/host-network-cleanup.sh"
  "$SCRIPT_DIR/security/cgroup-defaults.sh"
  "$SCRIPT_DIR/security/cgroup-overrides.sh"
  "$SCRIPT_DIR/security/safe-stop.sh"
  "$SCRIPT_DIR/contracts/rollback.sh"
  "$SCRIPT_DIR/observability/event-log.sh"
)

for test_script in "${TESTS[@]}"; do
  echo
  echo "[run-all] running: $test_script"
  "$test_script"
done

echo
echo "[run-all] all e2e tests passed"
