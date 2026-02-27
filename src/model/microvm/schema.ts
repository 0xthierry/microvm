import { z } from "zod";
import { vmStatusSchema } from "./vm-status";

export const vmRuntimeSchema = z.object({
  firecrackerPid: z.number().int().positive(),
  hostIface: z.string().min(1),
  apiSocketPath: z.string().min(1),
  bootArgs: z.string().min(1),
  kernelPath: z.string().min(1),
  jailerVmDir: z.string().min(1),
  firecrackerBinaryPath: z.string().min(1),
  jailerBinaryPath: z.string().min(1),
  releaseTag: z.string().min(1),
  kernelCiVersion: z.string().min(1),
  kernelVersion: z.string().min(1),
  startedAt: z.string().min(1),
});

export const microVmDtoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  index: z.number().int().nonnegative(),
  vcpuCount: z.number().int().positive(),
  memSizeMib: z.number().int().positive(),
  diskSizeMib: z.number().int().positive(),
  dockerfilePath: z.string().min(1),
  sshUser: z.string().min(1),
  hostIp: z.string().min(1),
  guestIp: z.string().min(1),
  guestMac: z.string().min(1),
  maskBits: z.string().min(1),
  maskLong: z.string().min(1),
  tapDev: z.string().min(1),
  rootfsPath: z.string().min(1),
  sshKeyPath: z.string().min(1),
  sshPublicKeyPath: z.string().min(1),
  rootfsSource: z.string().min(1),
  rootfsBuildHash: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  status: vmStatusSchema,
  failureReason: z.string().optional(),
  runtime: vmRuntimeSchema.optional(),
});

export type VmRuntimeDto = z.infer<typeof vmRuntimeSchema>;
export type MicroVmDto = z.infer<typeof microVmDtoSchema>;
