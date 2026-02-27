#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$PROJECT_ROOT/e2e/lib/steps.sh"
export MICROVM_HOME="${MICROVM_HOME:-${PROJECT_ROOT}/.microvm}"

VM_NAME="evlog$(date +%s | tail -c 7)"
LOW_MEMORY_START_CAP_BYTES="${TEST_LOW_MEMORY_START_CAP_BYTES:-700000000}"
KEEP_VM_ON_EXIT="${KEEP_VM_ON_EXIT:-0}"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-scripts/Dockerfile.test-ubuntu}"

CREATED_VM="0"
EVENT_LOG_PATH=""
VM_RESOLVED_ID=""

require_no_positional_args "e2e/observability/event-log.sh" "$@"

require_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    return
  fi
  echo "[event-log-e2e] missing dependency: $1" >&2
  exit 2
}

require_cmd bun
require_cmd ssh
require_cmd sudo

run_cli() {
  (
    cd "$PROJECT_ROOT"
    bun src/index.ts "$@"
  )
}

print_step() {
  local step="$1"
  case "$step" in
    Given\ *)
      bdd_given "${step#Given }"
      ;;
    When\ *)
      bdd_when "${step#When }"
      ;;
    Then\ *)
      bdd_then "${step#Then }"
      ;;
    And\ *)
      bdd_and "${step#And }"
      ;;
    *)
      bdd_when "$step"
      ;;
  esac
}

print_pass() {
  echo "[PASS] $1"
}

print_fail() {
  echo "[FAIL] $1" >&2
}

status_field() {
  local vm_ref="$1"
  local key_path="$2"
  run_cli status "$vm_ref" --json | bun -e '
    const fs = require("node:fs");
    const obj = JSON.parse(fs.readFileSync(0, "utf8"));
    const path = (process.argv[1] || "").split(".").filter(Boolean);
    let cur = obj;
    for (const key of path) {
      cur = cur?.[key];
    }
    process.stdout.write(cur === undefined || cur === null ? "" : String(cur));
  ' "$key_path"
}

assert_status_field() {
  local vm_ref="$1"
  local key_path="$2"
  local expected="$3"
  local actual
  actual="$(status_field "$vm_ref" "$key_path")"
  if [[ "$actual" == "$expected" ]]; then
    print_pass "$vm_ref: $key_path=$actual"
    return
  fi
  print_fail "$vm_ref: expected $key_path=$expected got=$actual"
  exit 1
}

event_log_path() {
  local vm_id="$1"
  printf '%s/runtime/events/%s.ndjson' "$MICROVM_HOME" "$vm_id"
}

count_events() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo 0
    return
  fi
  awk 'NF { count += 1 } END { print count + 0 }' "$path"
}

assert_event_log_exists() {
  local path="$1"
  if [[ -f "$path" ]]; then
    print_pass "event log exists: $path"
    return
  fi
  print_fail "event log not found: $path"
  exit 1
}

assert_operation_contract() {
  local file_path="$1"
  local vm_id="$2"
  local from_count="$3"
  local command="$4"
  local mode="$5"
  local output

  if ! output="$(bun -e '
    const fs = require("node:fs");

    const [filePath, vmId, fromCountRaw, command, mode] = process.argv.slice(1);
    const fail = (message) => {
      console.error(message);
      process.exit(1);
    };

    if (!filePath || !vmId || !fromCountRaw || !command || !mode) {
      fail("missing assert_operation_contract arguments");
    }
    if (!fs.existsSync(filePath)) {
      fail(`event log file does not exist: ${filePath}`);
    }

    const fromCount = Number(fromCountRaw);
    if (!Number.isInteger(fromCount) || fromCount < 0) {
      fail(`invalid fromCount: ${fromCountRaw}`);
    }

    const lines = fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (fromCount > lines.length) {
      fail(`fromCount ${fromCount} exceeds current event count ${lines.length}`);
    }

    const parsed = lines.map((line, idx) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        fail(`invalid JSON at line ${idx + 1}: ${String(error)}`);
      }
    });

    const chunk = parsed.slice(fromCount);
    const events = chunk.filter((event) => event?.vmId === vmId && event?.command === command);

    if (events.length === 0) {
      fail(`no ${command} events found in log chunk starting at index ${fromCount}`);
    }

    for (const [idx, event] of events.entries()) {
      if (typeof event.id !== "string" || event.id.length === 0) {
        fail(`${mode}: missing event.id for ${command} event #${idx + 1}`);
      }
      if (typeof event.vmId !== "string" || event.vmId !== vmId) {
        fail(`${mode}: unexpected event.vmId for ${command} event #${idx + 1}`);
      }
      if (typeof event.at !== "string" || event.at.length === 0) {
        fail(`${mode}: missing event.at for ${command} event #${idx + 1}`);
      }
      if (typeof event.type !== "string" || event.type.length === 0) {
        fail(`${mode}: missing event.type for ${command} event #${idx + 1}`);
      }
    }

    const hasType = (type) => events.some((event) => event.type === type);
    const hasCheckpoint = (checkpoint) =>
      events.some((event) => event.type === "checkpoint_reached" && event.checkpoint === checkpoint);
    const hasRollbackCheckpoint = (checkpoint) =>
      events.some((event) => event.type === "rollback_checkpoint" && event.checkpoint === checkpoint);
    const hasStateChange = (stateFrom, stateTo) =>
      events.some((event) => event.type === "state_changed" && event.stateFrom === stateFrom && event.stateTo === stateTo);

    /** @type {Array<[string, () => boolean]>} */
    const mustChecks = [];
    /** @type {Array<[string, () => boolean]>} */
    const forbidChecks = [];

    if (mode === "create_success") {
      mustChecks.push(
        ["operation_started", () => hasType("operation_started")],
        ["checkpoint create.validated_input", () => hasCheckpoint("create.validated_input")],
        ["checkpoint create.prepared_dirs", () => hasCheckpoint("create.prepared_dirs")],
        ["checkpoint create.prepared_rootfs", () => hasCheckpoint("create.prepared_rootfs")],
        ["checkpoint create.persisted_vm", () => hasCheckpoint("create.persisted_vm")],
        ["operation_succeeded", () => hasType("operation_succeeded")],
      );
      forbidChecks.push(
        ["operation_failed", () => hasType("operation_failed")],
        ["rollback_started", () => hasType("rollback_started")],
        ["rollback_failed", () => hasType("rollback_failed")],
      );
    } else if (mode === "up_success") {
      mustChecks.push(
        ["operation_started", () => hasType("operation_started")],
        ["checkpoint up.validated_input", () => hasCheckpoint("up.validated_input")],
        ["checkpoint up.network_ready", () => hasCheckpoint("up.network_ready")],
        ["checkpoint up.jailer_started", () => hasCheckpoint("up.jailer_started")],
        ["checkpoint up.vm_booted", () => hasCheckpoint("up.vm_booted")],
        ["checkpoint up.runtime_persisted", () => hasCheckpoint("up.runtime_persisted")],
        ["state_changed created->starting", () => hasStateChange("created", "starting")],
        ["state_changed starting->running", () => hasStateChange("starting", "running")],
        ["operation_succeeded", () => hasType("operation_succeeded")],
      );
      forbidChecks.push(
        ["operation_failed", () => hasType("operation_failed")],
        ["rollback_started", () => hasType("rollback_started")],
        ["rollback_failed", () => hasType("rollback_failed")],
      );
    } else if (mode === "down_success") {
      mustChecks.push(
        ["operation_started", () => hasType("operation_started")],
        ["checkpoint down.validated_input", () => hasCheckpoint("down.validated_input")],
        ["checkpoint down.vm_stopping", () => hasCheckpoint("down.vm_stopping")],
        ["checkpoint down.network_torn_down", () => hasCheckpoint("down.network_torn_down")],
        ["checkpoint down.runtime_cleared", () => hasCheckpoint("down.runtime_cleared")],
        ["state_changed running->stopping", () => hasStateChange("running", "stopping")],
        ["state_changed stopping->stopped", () => hasStateChange("stopping", "stopped")],
        ["operation_succeeded", () => hasType("operation_succeeded")],
      );
      forbidChecks.push(
        ["operation_failed", () => hasType("operation_failed")],
        ["rollback_started", () => hasType("rollback_started")],
        ["rollback_failed", () => hasType("rollback_failed")],
      );
    } else if (mode === "up_failure_rollback") {
      mustChecks.push(
        ["operation_started", () => hasType("operation_started")],
        ["checkpoint up.validated_input", () => hasCheckpoint("up.validated_input")],
        ["checkpoint up.network_ready", () => hasCheckpoint("up.network_ready")],
        ["rollback_started", () => hasType("rollback_started")],
        ["rollback_checkpoint up.network_ready", () => hasRollbackCheckpoint("up.network_ready")],
        ["operation_failed", () => hasType("operation_failed")],
      );
      forbidChecks.push(
        ["operation_succeeded", () => hasType("operation_succeeded")],
        ["rollback_failed", () => hasType("rollback_failed")],
      );

      const rollbackStarted = events.find((event) => event.type === "rollback_started");
      const checkpoints = rollbackStarted?.data?.checkpoints;
      const hasRollbackContext = Array.isArray(checkpoints)
        && checkpoints.some((entry) => entry?.checkpoint === "up.network_ready");
      if (!hasRollbackContext) {
        fail(`${mode}: rollback_started did not persist checkpoint context for up.network_ready`);
      }
    } else {
      fail(`unknown mode: ${mode}`);
    }

    for (const [label, check] of mustChecks) {
      if (!check()) {
        fail(`${mode}: missing required event: ${label}`);
      }
    }

    for (const [label, check] of forbidChecks) {
      if (check()) {
        fail(`${mode}: unexpected event present: ${label}`);
      }
    }

    process.stdout.write(`${mode}: validated ${events.length} ${command} events`);
  ' "$file_path" "$vm_id" "$from_count" "$command" "$mode" 2>&1)"; then
    print_fail "$output"
    exit 1
  fi

  print_pass "$output"
}

cleanup() {
  if [[ "$KEEP_VM_ON_EXIT" == "1" ]]; then
    return
  fi
  if [[ "$CREATED_VM" == "1" ]]; then
    run_cli delete "$VM_NAME" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

bdd_feature "Observability event log contracts"
bdd_scenario "Lifecycle operations append expected checkpoints, rollback trails, and cleanup"

if run_cli status "$VM_NAME" >/dev/null 2>&1; then
  print_fail "VM $VM_NAME already exists. Use a different name."
  exit 1
fi

print_step "Given a VM is created and emits create checkpoints"
run_cli create --name "$VM_NAME" --dockerfile "$DOCKERFILE_PATH"
CREATED_VM="1"
VM_RESOLVED_ID="$(status_field "$VM_NAME" "vm.vmId")"
if [[ -z "$VM_RESOLVED_ID" ]]; then
  print_fail "status did not return vm.vmId for $VM_NAME"
  exit 1
fi
EVENT_LOG_PATH="$(event_log_path "$VM_RESOLVED_ID")"
assert_event_log_exists "$EVENT_LOG_PATH"
assert_operation_contract "$EVENT_LOG_PATH" "$VM_RESOLVED_ID" "0" "create" "create_success"

print_step "When I start the VM"
EVENTS_BEFORE_UP_SUCCESS="$(count_events "$EVENT_LOG_PATH")"
run_cli up "$VM_NAME" --no-attach
assert_status_field "$VM_NAME" "running" "true"
assert_operation_contract "$EVENT_LOG_PATH" "$VM_RESOLVED_ID" "$EVENTS_BEFORE_UP_SUCCESS" "up" "up_success"

print_step "Then stopping the VM emits down success checkpoints"
EVENTS_BEFORE_DOWN_SUCCESS="$(count_events "$EVENT_LOG_PATH")"
run_cli down "$VM_NAME"
assert_status_field "$VM_NAME" "running" "false"
assert_operation_contract "$EVENT_LOG_PATH" "$VM_RESOLVED_ID" "$EVENTS_BEFORE_DOWN_SUCCESS" "down" "down_success"

print_step "When up fails intentionally, rollback events are persisted"
EVENTS_BEFORE_UP_FAILURE="$(count_events "$EVENT_LOG_PATH")"
if (
  cd "$PROJECT_ROOT"
  MICROVM_CGROUP_MEMORY_MAX="$LOW_MEMORY_START_CAP_BYTES" bun src/index.ts up "$VM_NAME" --no-attach
) >/tmp/microvm-event-log-up-fail.out 2>/tmp/microvm-event-log-up-fail.err; then
  print_fail "up unexpectedly succeeded with low memory profile"
  exit 1
fi
assert_status_field "$VM_NAME" "running" "false"
assert_status_field "$VM_NAME" "vm.status" "failed"
assert_operation_contract "$EVENT_LOG_PATH" "$VM_RESOLVED_ID" "$EVENTS_BEFORE_UP_FAILURE" "up" "up_failure_rollback"

print_step "Then deleting the VM removes its event log file"
if [[ ! -f "$EVENT_LOG_PATH" ]]; then
  print_fail "event log file missing before delete: $EVENT_LOG_PATH"
  exit 1
fi
run_cli delete "$VM_NAME"
CREATED_VM="0"
if run_cli status "$VM_NAME" >/tmp/microvm-event-log-status.out 2>/tmp/microvm-event-log-status.err; then
  print_fail "status unexpectedly succeeded after delete for $VM_NAME"
  exit 1
fi
if [[ -f "$EVENT_LOG_PATH" ]]; then
  print_fail "event log file still exists after delete: $EVENT_LOG_PATH"
  exit 1
fi
print_pass "delete removed event log file"

echo
echo "[event-log-e2e] event log contract checks passed"
