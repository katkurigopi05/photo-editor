import { z } from "zod";
import { animationEasingSchema } from "./animations.js";
import { microsecondStringSchema } from "./primitives.js";

/**
 * A transition is a timed opacity ramp attached to one end of a clip.
 *
 * Deliberately one mechanism rather than three: what the ramp *looks like* is
 * decided by whatever is underneath it at that moment, not by extra transition
 * machinery.
 *
 *   - nothing underneath        -> the clip fades from/to the background: a dip
 *   - a clip on a lower track   -> the two blend: a cross-track crossfade
 *   - the neighbouring clip on
 *     the same track, kept alive
 *     by a bounded overlap      -> a same-track crossfade
 *
 * `dip` differs from `cross` only in that it paints an explicit colour behind
 * the ramp, so "dip to white" does not depend on what the stage happens to be.
 *
 * `slide` moves the clip instead of fading it: the same eased curve drives a
 * normalized position offset while opacity stays at 1. It still blends with
 * whatever is underneath, because the clip genuinely uncovers it as it travels.
 */
export const TRANSITION_KINDS = ["cross", "dip", "slide"] as const;

export const transitionKindSchema = z.enum(TRANSITION_KINDS);
export type TransitionKind = z.infer<typeof transitionKindSchema>;

/**
 * Which screen edge a slide uses. On a `transitionIn` it is the edge the clip
 * enters *from*; on a `transitionOut` it is the edge it exits *toward*, so
 * "left" reads the same way round in both cases: the clip is off to the left.
 */
export const TRANSITION_DIRECTIONS = ["left", "right", "up", "down"] as const;
export const transitionDirectionSchema = z.enum(TRANSITION_DIRECTIONS);
export type TransitionDirection = z.infer<typeof transitionDirectionSchema>;

/** Which end of the clip a transition is attached to. */
export const TRANSITION_SIDES = ["in", "out"] as const;
export const transitionSideSchema = z.enum(TRANSITION_SIDES);
export type TransitionSide = z.infer<typeof transitionSideSchema>;

/** Positive canonical microseconds — a zero-length ramp has no progress to
 * sample and would divide by zero. */
const positiveMicrosecondStringSchema = microsecondStringSchema.refine(
  (value) => value !== "0",
  "duration must be greater than zero",
);

export const transitionSchema = z
  .object({
    id: z.string().min(1),
    kind: transitionKindSchema,
    durationUs: positiveMicrosecondStringSchema,
    easing: animationEasingSchema,
    colorHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "must be a valid 6-char hex color (#RRGGBB)")
      .optional(),
    direction: transitionDirectionSchema.optional(),
  })
  .strict()
  .superRefine((transition, ctx) => {
    if (transition.kind !== "dip" && transition.colorHex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["colorHex"],
        message: "colorHex applies only to a dip transition",
      });
    }
    if (transition.kind === "slide" && transition.direction === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["direction"],
        message: "a slide transition needs a direction",
      });
    }
    if (transition.kind !== "slide" && transition.direction !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["direction"],
        message: "direction applies only to a slide transition",
      });
    }
  });

export type Transition = z.infer<typeof transitionSchema>;

/**
 * Both ramps on one clip must fit inside it. They may exactly fill it — a
 * clip that is entirely a fade in followed by a fade out is legitimate — but
 * they may not overlap, because two ramps competing for the same frames have
 * no single correct opacity.
 */
export function transitionsFitClip(
  clipDurationUs: string,
  transitionInUs: string | undefined,
  transitionOutUs: string | undefined,
): boolean {
  const total =
    (transitionInUs === undefined ? 0n : BigInt(transitionInUs)) +
    (transitionOutUs === undefined ? 0n : BigInt(transitionOutUs));
  return total <= BigInt(clipDurationUs);
}
