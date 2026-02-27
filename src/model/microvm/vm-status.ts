import { z } from "zod";

export enum VmStatus {
  CREATED = "created",
  STARTING = "starting",
  RUNNING = "running",
  STOPPING = "stopping",
  STOPPED = "stopped",
  DELETING = "deleting",
  FAILED = "failed",
}

export const vmStatusSchema = z.nativeEnum(VmStatus);
export type VmStatusDto = z.infer<typeof vmStatusSchema>;
