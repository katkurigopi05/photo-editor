import { z } from "zod";
import {
  positiveSafeIntSchema,
  rationalSchema,
} from "@director/project-schema";

/**
 * Export presets: validated, JSON-serializable settings — the same Zod
 * discipline as commands. An export is a pure function of a specific project
 * version plus a preset, so it is reproducible and can run headless.
 */

export const videoCodecSchema = z.enum([
  "h264",
  "h265",
  "vp9",
  "av1",
  "prores",
  "png_sequence",
]);
export type VideoCodec = z.infer<typeof videoCodecSchema>;

export const containerSchema = z.enum(["mp4", "mov", "webm", "png_sequence"]);
export type Container = z.infer<typeof containerSchema>;

export const audioCodecSchema = z.enum(["aac", "opus", "flac", "none"]);
export type AudioCodec = z.infer<typeof audioCodecSchema>;

export const exportPresetSchema = z
  .object({
    width: positiveSafeIntSchema,
    height: positiveSafeIntSchema,
    frameRate: rationalSchema,
    videoCodec: videoCodecSchema,
    container: containerSchema,
    videoBitrateKbps: positiveSafeIntSchema,
    audioCodec: audioCodecSchema,
    audioSampleRate: positiveSafeIntSchema,
    audioBitrateKbps: positiveSafeIntSchema.optional(),
  })
  .strict();
export type ExportPreset = z.infer<typeof exportPresetSchema>;

/** Whether a video codec is valid inside a container (mirrors the Rust
 * `export-engine` crate). */
export function isCodecContainerCompatible(
  codec: VideoCodec,
  container: Container,
): boolean {
  switch (container) {
    case "mp4":
      return codec === "h264" || codec === "h265" || codec === "av1";
    case "mov":
      return codec === "h264" || codec === "h265" || codec === "prores";
    case "webm":
      return codec === "vp9" || codec === "av1";
    case "png_sequence":
      return codec === "png_sequence";
    default:
      return false;
  }
}

/**
 * What the browser exporter can actually produce.
 *
 * The schema above is deliberately wider — it mirrors the Rust
 * `export-engine` crate, which targets the full codec matrix. The browser path
 * is WebCodecs plus an MP4 muxer, and it hardcodes H.264 into MP4: a preset
 * asking for VP9/WebM used to be accepted and then quietly encoded as
 * H.264/MP4 anyway. Phase 6 requires export failures to be typed and
 * recoverable rather than silent, so callers check this first.
 */
export const BROWSER_VIDEO_CODECS: readonly VideoCodec[] = ["h264"];
export const BROWSER_CONTAINERS: readonly Container[] = ["mp4"];
export const BROWSER_AUDIO_CODECS: readonly AudioCodec[] = ["opus", "none"];

/**
 * Why the browser exporter cannot fulfil `preset`, or `null` if it can.
 *
 * Returns a message rather than a boolean so the reason reaches the user
 * instead of a bare refusal.
 */
export function browserPresetUnsupportedReason(
  preset: ExportPreset,
): string | null {
  if (!isCodecContainerCompatible(preset.videoCodec, preset.container)) {
    return `${preset.videoCodec} cannot be stored in a ${preset.container} container.`;
  }
  if (!BROWSER_VIDEO_CODECS.includes(preset.videoCodec)) {
    return `Browser export supports ${BROWSER_VIDEO_CODECS.join(", ")} video, not ${preset.videoCodec}.`;
  }
  if (!BROWSER_CONTAINERS.includes(preset.container)) {
    return `Browser export supports the ${BROWSER_CONTAINERS.join(", ")} container, not ${preset.container}.`;
  }
  if (!BROWSER_AUDIO_CODECS.includes(preset.audioCodec)) {
    return `Browser export supports ${BROWSER_AUDIO_CODECS.join(", ")} audio, not ${preset.audioCodec}.`;
  }
  return null;
}
