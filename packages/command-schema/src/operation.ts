import { z } from "zod";
import {
  isoInstantSchema,
  nonNegativeSafeIntSchema,
} from "@director/project-schema";
import { uuidSchema } from "./envelope.js";
import { projectCommandSchema } from "./public-commands.js";
import { internalCommandSchema } from "./internal-commands.js";

/**
 * A serializable, reversible, replayable record of one applied command.
 * `resultingVersion` is always `baseVersion + 1`. `id` and `createdAt` equal
 * the embedded forward command's envelope values.
 */
export const projectOperationSchema = z
  .object({
    id: uuidSchema,
    baseVersion: nonNegativeSafeIntSchema,
    resultingVersion: nonNegativeSafeIntSchema,
    command: projectCommandSchema,
    inverse: internalCommandSchema,
    createdAt: isoInstantSchema,
  })
  .strict();

export type ProjectOperation = z.infer<typeof projectOperationSchema>;
