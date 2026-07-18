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
