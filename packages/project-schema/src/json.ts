import { z } from "zod";
import type { JsonValue } from "@director/canonical-json";

/** A JSON-native value (no `undefined`, no `bigint`). Numbers must be finite. */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().refine((n) => Number.isFinite(n), "must be finite"),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

/** A JSON object with JSON-native values. */
export const jsonObjectSchema = z.record(jsonValueSchema);
