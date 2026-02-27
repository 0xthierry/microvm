export enum CreateCheckpoint {
  VALIDATED_INPUT = "create.validated_input",
  PREPARED_DIRS = "create.prepared_dirs",
  PREPARED_ROOTFS = "create.prepared_rootfs",
  PERSISTED_VM = "create.persisted_vm",
}

export enum UpCheckpoint {
  VALIDATED_INPUT = "up.validated_input",
  NETWORK_READY = "up.network_ready",
  JAILER_STARTED = "up.jailer_started",
  VM_BOOTED = "up.vm_booted",
  RUNTIME_PERSISTED = "up.runtime_persisted",
}

export enum DownCheckpoint {
  VALIDATED_INPUT = "down.validated_input",
  VM_STOPPING = "down.vm_stopping",
  NETWORK_TORN_DOWN = "down.network_torn_down",
  RUNTIME_CLEARED = "down.runtime_cleared",
}

export enum DeleteCheckpoint {
  VALIDATED_INPUT = "delete.validated_input",
  RUNTIME_STOPPED = "delete.runtime_stopped",
  ASSETS_REMOVED = "delete.assets_removed",
  RECORD_DELETED = "delete.record_deleted",
}

export type VmCheckpoint =
  | CreateCheckpoint
  | UpCheckpoint
  | DownCheckpoint
  | DeleteCheckpoint;
