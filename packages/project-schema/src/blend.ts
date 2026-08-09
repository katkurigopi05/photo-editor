import { z } from "zod";

/**
 * Blend modes: how a clip's pixels combine with whatever is already beneath it.
 *
 * Everything composites with normal alpha until told otherwise, which is the
 * one-layer-hides-another model. A blend mode is what turns a stack of clips
 * into a composite: a texture on Multiply darkens, a light leak on Screen only
 * brightens, an Overlay grade lands on the picture rather than over it.
 *
 * The list is deliberately exactly the separable and non-separable modes the
 * W3C compositing spec defines, under the same names, because that is what
 * `globalCompositeOperation` accepts and what every other editor calls them.
 * Inventing a name here would mean translating it in three render paths and
 * explaining it to someone who already knows what Soft Light is.
 */

/**
 * `normal` is the absence of a blend mode rather than a mode of its own — it is
 * what canvas calls `source-over` — but it is named here so the UI has
 * something to show and a command has something to set when going back.
 */
export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

export const blendModeSchema = z.enum(BLEND_MODES);
export type BlendMode = z.infer<typeof blendModeSchema>;

/**
 * The `globalCompositeOperation` for a mode.
 *
 * Every name maps to itself except `normal`, and that exception is the whole
 * reason this function exists rather than a cast: passing "normal" to a canvas
 * is silently ignored, leaving whatever operation the previous layer set — one
 * clip's Multiply would then quietly apply to the next.
 */
export function compositeOperation(mode: BlendMode): GlobalCompositeOperation {
  return mode === "normal" ? "source-over" : mode;
}
