#!/usr/bin/env bash

set -euo pipefail

if [[ -n "${MICROVM_BDD_LOADED:-}" ]]; then
  return 0
fi
MICROVM_BDD_LOADED="1"

bdd_feature() {
  printf '\nFeature: %s\n' "$1"
}

bdd_scenario() {
  printf '\n  Scenario: %s\n' "$1"
}

bdd_given() {
  printf '    Given %s\n' "$1"
}

bdd_when() {
  printf '    When %s\n' "$1"
}

bdd_then() {
  printf '    Then %s\n' "$1"
}

bdd_and() {
  printf '    And %s\n' "$1"
}

require_no_positional_args() {
  local script_name="$1"
  shift
  if (( $# == 0 )); then
    return
  fi
  printf '[%s] positional arguments are not supported; use environment variables instead.\n' "$script_name" >&2
  exit 2
}
