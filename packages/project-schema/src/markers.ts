import { z } from "zod";
import { microsecondStringSchema } from "./primitives.js";

/**
 * Markers: a note pinned to a moment of a clip.
 *
 * They ride the clip, not the timeline — Final Cut's model — so moving or
 * trimming a clip carries its notes with it. That is why the time is
 * clip-local microseconds, the same coordinate space keyframes use, rather than
 * a timeline position that every move would have to rewrite.
 *
 * A marker changes nothing about the render. It exists to be found again.
 */

/** Standard is a note; chapter is a navigation point an export can carry; todo
 * is a note with a completion state. Nothing else earns a kind. */
export const MARKER_KINDS = ["standard", "chapter", "todo"] as const;
export const markerKindSchema = z.enum(MARKER_KINDS);
export type MarkerKind = z.infer<typeof markerKindSchema>;

export const clipMarkerSchema = z
  .object({
    id: z.string().min(1),
    /** Clip-local microseconds, as a canonical decimal string. */
    timeUs: microsecondStringSchema,
    name: z.string().min(1).max(200),
    kind: markerKindSchema,
    /** Only meaningful for `todo`. Absent rather than false when untouched, so
     * a project written before anything was ticked parses byte-identically. */
    done: z.boolean().optional(),
  })
  .strict();

export type ClipMarker = z.infer<typeof clipMarkerSchema>;

/** Markers on one clip. Ids are unique so a command can name one; two markers
 * may share an instant, because two notes about the same frame is ordinary. */
export const clipMarkersSchema = z
  .array(clipMarkerSchema)
  .refine(
    (markers) => new Set(markers.map((m) => m.id)).size === markers.length,
    { message: "marker ids must be unique within a clip" },
  );
