import { z } from "zod";
import {
  isoInstantSchema,
  nonNegativeSafeIntSchema,
} from "@director/project-schema";

/** RFC 4122 UUID, lowercase hyphenated form (version 1-5, RFC variant). */
export const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    { message: "must be an RFC 4122 UUID in lowercase hyphenated form" },
  );

export const actorSchema = z
  .object({
    type: z.enum(["user", "agent", "system"]),
    id: z.string().min(1),
  })
  .strict();
export type Actor = z.infer<typeof actorSchema>;

/**
 * Base fields shared by every public command envelope. All data that affects
 * output is present in the command; the envelope carries no ambient state.
 */
export const envelopeBaseShape = {
  id: uuidSchema,
  baseVersion: nonNegativeSafeIntSchema,
  actor: actorSchema,
  createdAt: isoInstantSchema,
} as const;
