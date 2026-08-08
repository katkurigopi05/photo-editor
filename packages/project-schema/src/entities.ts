import { z } from "zod";
import { animationTracksSchema } from "./animations.js";
import { transitionSchema } from "./transitions.js";
import { effectInstanceSchema } from "./effects.js";
import { clipMasksSchema } from "./masks.js";
import { clipMarkersSchema } from "./markers.js";
import { assetKeywordsSchema } from "./keywords.js";
import {
  audioGainDbSchema,
  audioPanSchema,
  canonicalDecimalStringSchema,
  checksumSchema,
  isoInstantSchema,
  microsecondStringSchema,
  nonNegativeSafeIntSchema,
  positiveSafeIntSchema,
  rationalSchema,
  clipPlaybackRateSchema,
} from "./primitives.js";

export const assetKindSchema = z.enum(["image", "video", "audio", "generated"]);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const assetRatingSchema = z.enum(["favorite", "rejected"]);
export type AssetRating = z.infer<typeof assetRatingSchema>;

export const trackKindSchema = z.enum(["video", "audio"]);
export type TrackKind = z.infer<typeof trackKindSchema>;

export const mediaAssetMetadataSchema = z
  .object({
    fileSizeBytes: canonicalDecimalStringSchema,
    durationUs: microsecondStringSchema.optional(),
    width: positiveSafeIntSchema.optional(),
    height: positiveSafeIntSchema.optional(),
    frameRate: rationalSchema.optional(),
  })
  .strict();
export type MediaAssetMetadata = z.infer<typeof mediaAssetMetadataSchema>;

export const mediaAssetSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    kind: assetKindSchema,
    originalUri: z.string().min(1),
    checksum: checksumSchema,
    metadata: mediaAssetMetadataSchema,
    // Optional so projects created before media ratings continue to parse to
    // byte-equivalent state. Clearing a rating removes this member.
    rating: assetRatingSchema.optional(),
    // Optional like `rating`, and for the same reason: an asset registered
    // before keywords existed must parse byte-for-byte identically.
    keywords: assetKeywordsSchema.optional(),
    createdAt: isoInstantSchema,
  })
  .strict();
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

/** A fully materialized timeline clip as stored in project state. */
export const timelineClipSchema = z
  .object({
    id: z.string().min(1),
    assetId: z.string().min(1),
    trackId: z.string().min(1),
    timelineStartUs: microsecondStringSchema,
    timelineDurationUs: microsecondStringSchema,
    sourceInUs: microsecondStringSchema,
    sourceOutUs: microsecondStringSchema,
    playbackRate: clipPlaybackRateSchema,
    audioGainDb: audioGainDbSchema,
    audioPan: audioPanSchema,
    effects: z.array(effectInstanceSchema),
    // Optional for the same reason as `animations`: every project written
    // before masks existed must still parse byte-for-byte identically.
    masks: clipMasksSchema.optional(),
    // Optional for the same reason as `masks`: a project written before
    // markers existed must still parse byte-for-byte identically.
    markers: clipMarkersSchema.optional(),
    // Optional preserves byte-equivalent parsing of schema-v1 projects. New
    // animation commands will materialize the array only when first used.
    animations: animationTracksSchema.optional(),
    // Same reasoning as `animations`: absent on every pre-transition project.
    transitionIn: transitionSchema.optional(),
    transitionOut: transitionSchema.optional(),
  })
  // Intentionally a plain object schema, not a superRefine: command-schema
  // derives payloads from this with `.omit()`, which only exists on ZodObject.
  // The cross-field rule that both ramps must fit inside the clip is enforced
  // by the reducer via `transitionsFitClip`, alongside OVERLAP and the other
  // cross-field invariants.
  .strict();
export type TimelineClip = z.infer<typeof timelineClipSchema>;

export const trackSchema = z
  .object({
    id: z.string().min(1),
    kind: trackKindSchema,
    name: z.string(),
    index: nonNegativeSafeIntSchema,
    clips: z.array(timelineClipSchema),
  })
  .strict();
export type Track = z.infer<typeof trackSchema>;

export const sequenceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    width: positiveSafeIntSchema,
    height: positiveSafeIntSchema,
    frameRate: rationalSchema,
    tracks: z.array(trackSchema),
  })
  .strict();
export type Sequence = z.infer<typeof sequenceSchema>;

export const projectSettingsSchema = z
  .object({
    defaultFrameRate: rationalSchema,
  })
  .strict();
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export const projectSchema = z
  .object({
    id: z.string().min(1),
    ownerId: z.string().min(1),
    name: z.string(),
    schemaVersion: z.literal(1),
    currentVersion: nonNegativeSafeIntSchema,
    settings: projectSettingsSchema,
    assets: z.array(mediaAssetSchema),
    sequences: z.array(sequenceSchema),
    createdAt: isoInstantSchema,
    updatedAt: isoInstantSchema,
  })
  .strict();
export type Project = z.infer<typeof projectSchema>;

/** Track compatibility rules for placing an asset on a track. */
export function isAssetCompatibleWithTrack(
  trackKind: TrackKind,
  assetKind: AssetKind,
): boolean {
  if (trackKind === "video") {
    return (
      assetKind === "video" ||
      assetKind === "image" ||
      assetKind === "generated"
    );
  }
  // audio track
  return assetKind === "audio" || assetKind === "video";
}
