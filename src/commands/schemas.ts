import { z } from "zod";

export const flagValueSchema = z.union([z.string(), z.boolean()]);

export const noFlagsSchema = z.object({}).strict();

export const positionalsSchema = (command: string, maxCount: number) =>
  z.array(z.string()).max(maxCount, {
    message: `Too many positional arguments for \"${command}\".`,
  });
