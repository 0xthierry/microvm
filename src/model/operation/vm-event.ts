import { z } from "zod";
import {
  CreateCheckpoint,
  DeleteCheckpoint,
  DownCheckpoint,
  UpCheckpoint,
} from "./checkpoints";

export const vmOperationCommandSchema = z.enum(["create", "up", "down", "delete"]);
export type VmOperationCommand = z.infer<typeof vmOperationCommandSchema>;

export const vmEventTypeSchema = z.enum([
  "operation_started",
  "checkpoint_reached",
  "state_changed",
  "rollback_started",
  "rollback_checkpoint",
  "operation_succeeded",
  "operation_failed",
  "rollback_failed",
]);
export type VmEventType = z.infer<typeof vmEventTypeSchema>;

const vmCheckpointSchema = z.union([
  z.nativeEnum(CreateCheckpoint),
  z.nativeEnum(UpCheckpoint),
  z.nativeEnum(DownCheckpoint),
  z.nativeEnum(DeleteCheckpoint),
]);

const errorSchema = z.object({
  message: z.string().min(1),
  name: z.string().min(1),
  stack: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const vmEventSchema = z.object({
  id: z.string().min(1),
  vmId: z.string().min(1),
  at: z.string().min(1),
  command: vmOperationCommandSchema,
  type: vmEventTypeSchema,
  stateFrom: z.string().optional(),
  stateTo: z.string().optional(),
  checkpoint: vmCheckpointSchema.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: errorSchema.optional(),
});

export type VmEvent = z.infer<typeof vmEventSchema>;
