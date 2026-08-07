import {
  exportPresetSchema,
  type ExportPreset,
} from "@director/export-engine";

/**
 * The export dialog's fields, and the validated preset they become.
 *
 * Kept out of `main.ts` because this is the boundary where a person's typing
 * meets a schema an encoder will trust: every refusal should happen here, with
 * a sentence naming the field, rather than three layers down inside WebCodecs
 * where the message is "invalid config".
 */

export interface ExportFields {
  /** `WIDTHxHEIGHT`, or `custom` to use the two fields below. */
  resolution: string;
  customWidth: string;
  customHeight: string;
  /** An integer, or `numerator/denominator` for broadcast rates. */
  frameRate: string;
  bitrateKbps: string;
  audioCodec: string;
  audioBitrateKbps: string;
}

export type PresetResult =
  | { ok: true; preset: ExportPreset }
  | { ok: false; error: string };

export interface Choice {
  value: string;
  label: string;
}

/** Every value is even-sided: H.264 subsamples chroma 2x2, so odd dimensions
 * are not encodable. */
export const RESOLUTION_CHOICES: readonly Choice[] = [
  { value: "3840x2160", label: "4K UHD — 3840×2160" },
  { value: "2560x1440", label: "1440p — 2560×1440" },
  { value: "1920x1080", label: "1080p — 1920×1080" },
  { value: "1280x720", label: "720p — 1280×720" },
  { value: "854x480", label: "480p — 854×480" },
  { value: "custom", label: "Custom…" },
];

/**
 * Frame rates as exact rationals.
 *
 * 29.97 is 30000/1001, not 29.97. The timeline is microsecond-exact and the
 * frame-index maths is done in BigInt; a decimal rate here would drift against
 * it by a frame every few minutes, which is precisely the class of error the
 * rational model exists to prevent.
 */
export const FRAME_RATE_CHOICES: readonly Choice[] = [
  { value: "24", label: "24 — cinema" },
  { value: "25", label: "25 — PAL" },
  { value: "30000/1001", label: "29.97 — NTSC" },
  { value: "30", label: "30" },
  { value: "50", label: "50" },
  { value: "60000/1001", label: "59.94" },
  { value: "60", label: "60" },
];

export const BITRATE_CHOICES: readonly Choice[] = [
  { value: "40000", label: "Very high (40 Mbps)" },
  { value: "20000", label: "High (20 Mbps)" },
  { value: "12000", label: "Good (12 Mbps)" },
  { value: "8000", label: "Medium (8 Mbps)" },
  { value: "4000", label: "Low (4 Mbps)" },
  { value: "custom", label: "Custom…" },
];

export const AUDIO_BITRATE_CHOICES: readonly Choice[] = [
  { value: "256", label: "256 kbps" },
  { value: "192", label: "192 kbps" },
  { value: "128", label: "128 kbps" },
  { value: "96", label: "96 kbps" },
];

/** Anything wider or taller than this is a typo, not an intention. */
const MAX_DIMENSION = 7680;

function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Round up to the next even number: chroma subsampling needs even sides, and
 * rounding up never crops. */
const toEven = (value: number): number => (value % 2 === 0 ? value : value + 1);

function parseFrameRate(
  value: string,
): { numerator: number; denominator: number } | null {
  const [left, right] = value.split("/");
  const numerator = parsePositiveInt(left ?? "");
  if (numerator === null) return null;
  if (right === undefined) return { numerator, denominator: 1 };
  const denominator = parsePositiveInt(right);
  return denominator === null ? null : { numerator, denominator };
}

export function buildExportPreset(fields: ExportFields): PresetResult {
  let width: number | null;
  let height: number | null;
  if (fields.resolution === "custom") {
    width = parsePositiveInt(fields.customWidth);
    height = parsePositiveInt(fields.customHeight);
    if (width === null || height === null) {
      return { ok: false, error: "Enter a width and height in whole pixels." };
    }
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      return {
        ok: false,
        error: `Width and height must be ${MAX_DIMENSION} pixels or less.`,
      };
    }
    width = toEven(width);
    height = toEven(height);
  } else {
    const [w, h] = fields.resolution.split("x");
    width = parsePositiveInt(w ?? "");
    height = parsePositiveInt(h ?? "");
    if (width === null || height === null) {
      return { ok: false, error: "Choose a resolution." };
    }
  }

  const frameRate = parseFrameRate(fields.frameRate);
  if (frameRate === null) {
    return { ok: false, error: "Choose a frame rate." };
  }

  const videoBitrateKbps = parsePositiveInt(fields.bitrateKbps);
  if (videoBitrateKbps === null) {
    return { ok: false, error: "Enter a video bitrate above zero, in kbps." };
  }

  const audioOff = fields.audioCodec === "none";
  const audioBitrateKbps = audioOff
    ? null
    : parsePositiveInt(fields.audioBitrateKbps);
  if (!audioOff && audioBitrateKbps === null) {
    return { ok: false, error: "Enter an audio bitrate above zero, in kbps." };
  }

  const candidate = {
    width,
    height,
    frameRate,
    videoCodec: "h264" as const,
    container: "mp4" as const,
    videoBitrateKbps,
    // Opus rather than AAC: it is what this path actually encodes with —
    // royalty-free and reliably software-encoded in every Chromium build,
    // whereas WebCodecs AAC support is inconsistent and hardware-dependent.
    audioCodec: audioOff ? ("none" as const) : ("opus" as const),
    audioSampleRate: 48000,
    ...(audioBitrateKbps === null ? {} : { audioBitrateKbps }),
  };

  const parsed = exportPresetSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue
        ? `${issue.path.join(".") || "preset"}: ${issue.message}`
        : "Those export settings are not valid.",
    };
  }
  return { ok: true, preset: parsed.data };
}

/**
 * An H.264 codec string whose level can actually carry the frame.
 *
 * A level is a throughput contract — macroblocks per second and per frame — and
 * an encoder handed a level too low for the picture fails inside WebCodecs with
 * an opaque message. The level is therefore derived from the picture rather
 * than hardcoded, which is what makes 4K export possible at all.
 *
 * Constrained Baseline (0x42 with the constraint flags at 0x00) throughout: it
 * is the profile every decoder and player understands.
 */
export function h264CodecString(
  width: number,
  height: number,
  fps: number,
): string {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const macroblocksPerSecond = macroblocks * fps;

  // [level byte, max macroblocks per frame, max macroblocks per second]
  const LEVELS: ReadonlyArray<[number, number, number]> = [
    [0x1e, 1620, 40500], // 3.0
    [0x1f, 3600, 108000], // 3.1
    [0x20, 5120, 216000], // 3.2
    [0x28, 8192, 245760], // 4.0
    [0x29, 8192, 245760], // 4.1
    [0x2a, 8704, 522240], // 4.2
    [0x32, 22080, 589824], // 5.0
    [0x33, 36864, 983040], // 5.1
    [0x34, 36864, 2073600], // 5.2
  ];

  for (const [level, maxFrame, maxRate] of LEVELS) {
    if (macroblocks <= maxFrame && macroblocksPerSecond <= maxRate) {
      return `avc1.4200${level.toString(16).padStart(2, "0")}`;
    }
  }
  // Beyond the table, ask for the highest level rather than silently choosing
  // one that cannot carry the frame.
  return "avc1.420034";
}
