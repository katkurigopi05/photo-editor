import { CODEC_CONTAINER, codecStringFor } from "./export-preset.js";

/**
 * What this browser can actually encode.
 *
 * The export schema mirrors the Rust `export-engine` crate and is deliberately
 * wider than the browser path. Which of that the browser will really do is not
 * a matter of opinion or of user agent strings — it varies by operating system,
 * by build, and by whether a hardware encoder is present. Chromium on one
 * machine encodes AV1 and on another does not.
 *
 * So it is asked rather than assumed, through `VideoEncoder.isConfigSupported`,
 * and whatever comes back is what the export dialog offers. The same principle
 * the preview's auto-scaling follows: measure the machine in front of you.
 */

/** Codecs the browser exporter knows how to build a config and a container for.
 * Anything else in the schema belongs to the native crate. */
export const ATTEMPTABLE_CODECS = ["h264", "vp9", "av1"] as const;
export type AttemptableCodec = (typeof ATTEMPTABLE_CODECS)[number];

export interface CodecSupport {
  codec: AttemptableCodec;
  container: "mp4" | "webm";
  supported: boolean;
  /** The codec string that was asked about, for the report and for errors. */
  codecString: string;
  /** Present when unsupported: why, in words that name the codec. */
  reason?: string;
}

export const CODEC_LABELS: Readonly<Record<AttemptableCodec, string>> = {
  h264: "H.264 (MP4)",
  vp9: "VP9 (WebM)",
  av1: "AV1 (WebM)",
};

/**
 * Ask the browser about each codec at the size and rate actually wanted.
 *
 * Asked at the real dimensions rather than at a nominal 1080p: support is a
 * function of level, and a browser that encodes VP9 at 720p may refuse 4K. A
 * probe at the wrong size would offer a codec that then failed at the click.
 */
export async function probeVideoCodecs(
  width: number,
  height: number,
  fps: number,
  bitrateKbps: number,
): Promise<CodecSupport[]> {
  const results: CodecSupport[] = [];
  for (const codec of ATTEMPTABLE_CODECS) {
    const codecString = codecStringFor(codec, width, height, fps);
    const container = CODEC_CONTAINER[codec] as "mp4" | "webm";
    if (codecString === null) {
      results.push({
        codec,
        container,
        supported: false,
        codecString: "",
        reason: `No codec string is defined for ${codec}.`,
      });
      continue;
    }
    if (typeof VideoEncoder === "undefined") {
      results.push({
        codec,
        container,
        supported: false,
        codecString,
        reason: "This browser has no VideoEncoder, so it cannot encode video.",
      });
      continue;
    }
    // A rejected promise is a refusal like any other — some builds throw on an
    // unknown codec string rather than answering false.
    const support = await VideoEncoder.isConfigSupported({
      codec: codecString,
      width,
      height,
      bitrate: bitrateKbps * 1000,
      framerate: fps,
    }).catch(() => null);
    const ok = support?.supported === true;
    results.push({
      codec,
      container,
      supported: ok,
      codecString,
      ...(ok
        ? {}
        : {
            reason: `This browser will not encode ${CODEC_LABELS[codec]} at ${width}×${height} at ${Math.round(fps)}fps.`,
          }),
    });
  }
  return results;
}

/** The codecs to offer, best-supported first, keeping H.264 ahead of the rest
 * because it is the one every player opens. */
export function offerable(results: readonly CodecSupport[]): CodecSupport[] {
  return results.filter((r) => r.supported);
}

/** A line per codec for the device report: what is available and why not. */
export function describeCodecSupport(
  results: readonly CodecSupport[],
): string[] {
  if (results.length === 0) return [];
  const yes = results.filter((r) => r.supported).map((r) => CODEC_LABELS[r.codec]);
  const lines: string[] = [];
  lines.push(
    yes.length > 0
      ? `Video export codecs available here: ${yes.join(", ")}.`
      : "No video export codec is available in this browser.",
  );
  for (const r of results) {
    if (!r.supported && r.reason) lines.push(r.reason);
  }
  return lines;
}
