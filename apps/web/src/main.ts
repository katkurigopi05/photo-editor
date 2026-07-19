import {
  EditorSession,
  buildCreateProject,
  buildCreateSequence,
  buildAddTrack,
  buildRegisterAsset,
  buildAddClip,
  buildMoveClip,
  buildTrimClip,
  buildDeleteClip,
  buildAddEffect,
  buildUpdateEffectParams,
  buildRemoveEffect,
  buildSetClipAudioGain,
  buildSetClipAudioPan,
  resolveClipDrag,
  usToPixels,
  type CommandContext,
} from "@director/ui-kit";
import {
  createPlaybackState,
  play,
  pause,
  seek,
  tick,
  resolveAtTime,
  sequenceDurationUs,
  timeToFrameIndex,
  frameToStartTimeUs,
  type PlaybackState,
} from "@director/playback-controller";
import { planExport } from "@director/export-engine";
import {
  PRESETS,
  PRESET_LABELS,
  deriveTheme,
  applyThemeTokens,
  loadCustomThemes,
  upsertCustomTheme,
  deleteCustomTheme,
  MAX_CUSTOM_THEMES,
  type ThemeTokens,
} from "./theme.js";
import { RasterSession, canvasPointToImage } from "./raster.js";
import {
  stampBrush,
  cloneStamp,
  applyMaskDelete,
  applyMaskFill,
  polygonMask,
  floodFillMask,
  invertMask,
  featherMask,
  unsharpMask,
  diffusionFill,
  colorKeyAlpha,
  cornerKeyColor,
  cropImage,
  resizeImage,
  rotateImage,
  shiftImage,
  cloneImage as cloneRasterImage,
  type Mask,
  type Point,
  type RasterImage,
} from "@director/raster-tools";
import type {
  EffectInstance,
  EffectType,
  MediaAsset,
  Sequence,
  TimelineClip,
  Track,
} from "@director/project-schema";

// ==========================================================================
// Effect catalogue — drives the inspector sliders and the preview filters.
// Ranges/defaults mirror @director/project-schema effect params.
// ==========================================================================
type ParamKind = "range" | "toggle" | "color";
interface ParamSpec {
  name: string;
  label: string;
  kind: ParamKind;
  min?: number;
  max?: number;
  step?: number;
  def: number | boolean | string;
}
interface EffectSpec {
  type: EffectType;
  label: string;
  modes: Array<"video" | "photo">;
  params: ParamSpec[];
}

const range = (
  name: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
): ParamSpec => ({ name, label, kind: "range", min, max, step, def });

const EFFECTS: EffectSpec[] = [
  {
    type: "color.brightness",
    label: "Brightness",
    modes: ["video", "photo"],
    params: [range("amount", "Amount", -1, 1, 0.05, 0)],
  },
  {
    type: "color.contrast",
    label: "Contrast",
    modes: ["video", "photo"],
    params: [range("amount", "Amount", 0, 4, 0.05, 1)],
  },
  {
    type: "color.saturate",
    label: "Saturation",
    modes: ["video", "photo"],
    params: [range("amount", "Amount", 0, 5, 0.05, 1)],
  },
  {
    type: "color.exposure",
    label: "Exposure",
    modes: ["video", "photo"],
    params: [range("amount", "Stops", -2, 2, 0.1, 0)],
  },
  {
    type: "color.hue_rotate",
    label: "Hue Rotate",
    modes: ["video"],
    params: [range("angleDegrees", "Angle", -180, 180, 1, 0)],
  },
  {
    type: "color.grayscale",
    label: "Grayscale",
    modes: ["photo"],
    params: [range("amount", "Amount", 0, 1, 0.05, 1)],
  },
  {
    type: "color.sepia",
    label: "Sepia",
    modes: ["photo"],
    params: [range("amount", "Amount", 0, 1, 0.05, 1)],
  },
  {
    type: "color.invert",
    label: "Invert",
    modes: ["video", "photo"],
    params: [range("amount", "Amount", 0, 1, 0.05, 1)],
  },
  {
    type: "blur.gaussian",
    label: "Gaussian Blur",
    modes: ["video", "photo"],
    params: [range("radiusPx", "Radius (px)", 0, 50, 1, 5)],
  },
  {
    type: "transform.opacity",
    label: "Opacity",
    modes: ["video", "photo"],
    params: [range("opacity", "Opacity", 0, 1, 0.05, 1)],
  },
  {
    type: "transform.crop",
    label: "Crop / Reframe",
    modes: ["video", "photo"],
    params: [
      range("x", "Left", 0, 0.9, 0.01, 0),
      range("y", "Top", 0, 0.9, 0.01, 0),
      range("width", "Width", 0.1, 1, 0.01, 1),
      range("height", "Height", 0.1, 1, 0.01, 1),
    ],
  },
  {
    type: "transform.rotate",
    label: "Rotate",
    modes: ["video", "photo"],
    params: [range("angleDegrees", "Angle", -360, 360, 1, 0)],
  },
  {
    type: "transform.flip",
    label: "Flip",
    modes: ["video", "photo"],
    params: [
      { name: "horizontal", label: "Horizontal", kind: "toggle", def: false },
      { name: "vertical", label: "Vertical", kind: "toggle", def: false },
    ],
  },
  {
    type: "color.vignette",
    label: "Vignette",
    modes: ["photo"],
    params: [range("amount", "Strength", 0, 1, 0.05, 0.5)],
  },
  {
    type: "color.tint",
    label: "Tint",
    modes: ["photo"],
    params: [
      { name: "colorHex", label: "Color", kind: "color", def: "#ff5a00" },
      range("amount", "Strength", 0, 1, 0.05, 0.2),
    ],
  },
  {
    type: "photo.portrait_blur",
    label: "Portrait Blur",
    modes: ["photo"],
    params: [
      range("blurRadiusPx", "Blur (px)", 0, 50, 1, 15),
      range("bokehStrength", "Bokeh", 0, 1, 0.05, 0.4),
      range("subjectScale", "Subject", 0.5, 1.5, 0.05, 1),
    ],
  },
  {
    type: "color.duotone",
    label: "Duotone",
    modes: ["photo"],
    params: [
      { name: "shadowsHex", label: "Shadows", kind: "color", def: "#2d004d" },
      {
        name: "highlightsHex",
        label: "Highlights",
        kind: "color",
        def: "#ff5a00",
      },
    ],
  },
  {
    type: "fx.retro_noise",
    label: "Retro Noise",
    modes: ["video"],
    params: [
      range("noiseAmount", "Noise", 0, 1, 0.05, 0.25),
      range("scanlineSpacing", "Scanlines", 2, 20, 1, 6),
    ],
  },
  {
    type: "fx.border",
    label: "Border",
    modes: ["photo"],
    params: [
      { name: "borderColorHex", label: "Color", kind: "color", def: "#ffffff" },
      range("borderWidthPx", "Width (px)", 0, 50, 1, 12),
    ],
  },
  {
    type: "fx.remove_background",
    label: "Remove Background",
    modes: ["photo", "video"],
    params: [
      { name: "auto", label: "Auto (from corners)", kind: "toggle", def: true },
      {
        name: "keyColorHex",
        label: "Key color",
        kind: "color",
        def: "#00ff00",
      },
      range("threshold", "Tolerance", 0, 1, 0.02, 0.12),
      range("softness", "Softness", 0, 1, 0.02, 0.1),
    ],
  },
];

const effectSpec = (type: string): EffectSpec | undefined =>
  EFFECTS.find((e) => e.type === type);

function defaultParams(
  spec: EffectSpec,
): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const p of spec.params) out[p.name] = p.def;
  return out;
}

// ==========================================================================
// Application state
// ==========================================================================
const PROJECT_ID = "project-1";
const SEQUENCE_ID = "sequence-1";
const VIDEO_TRACK = "video-1";
const AUDIO_TRACK = "audio-1";
const ACTOR = { type: "user", id: "user-1" } as const;
const FRAME_RATE = { numerator: 30, denominator: 1 };

const session = new EditorSession();
let mode: "video" | "photo" = "photo";
let selectedClipId: string | null = null;
let zoom = 120; // pixels per second
let playback: PlaybackState = createPlaybackState("0");
const mediaCache = new Map<string, HTMLImageElement | HTMLVideoElement>();

// -- Raster photo editing (Photo mode only; local session state, outside
// the deterministic command engine — see raster.ts) --
type RasterTool =
  | "move"
  | "crop"
  | "transform"
  | "brush"
  | "eraser"
  | "clone"
  | "lasso"
  | "wand"
  | "sharpen"
  | "smartfill"
  | "bgremove";
let rasterSession: RasterSession | null = null;
let rasterEditingClipId: string | null = null;
let rasterTool: RasterTool = "brush";
let rasterSelection: Mask | null = null;
let rasterSelectionOverlay: HTMLCanvasElement | null = null;
let cloneSource: Point | null = null;

type RasterDrag =
  | { kind: "stroke" }
  | { kind: "clone"; anchorDestX: number; anchorDestY: number; sourceSnapshot: RasterImage }
  | { kind: "lasso"; points: Point[] }
  | { kind: "crop"; startX: number; startY: number; rect: { x: number; y: number; width: number; height: number } }
  | { kind: "move"; startClientX: number; startClientY: number };
let rasterDrag: RasterDrag | null = null;

const rasterOptions = {
  brushColor: "#ff2d55",
  brushSize: 28,
  brushOpacity: 1,
  brushHardness: 0.85,
  eraserSize: 28,
  eraserOpacity: 1,
  eraserHardness: 0.85,
  cloneSize: 32,
  cloneOpacity: 1,
  cloneHardness: 0.85,
  wandTolerance: 0.2,
  wandContiguous: true,
  lassoFeather: 0,
  sharpenAmount: 0.6,
  smartFillIterations: 150,
  bgAuto: true,
  bgKeyColor: "#00ff00",
  bgThreshold: 0.12,
  bgSoftness: 0.1,
};

// ==========================================================================
// DOM references
// ==========================================================================
const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("preview");
const cctx = canvas.getContext("2d")!;
const stageEl = $<HTMLDivElement>("stage");
const stageEmpty = $<HTMLDivElement>("stage-empty");
const mediaListEl = $<HTMLDivElement>("media-list");
const historyEl = $<HTMLDivElement>("history-list");
const inspectorEl = $<HTMLDivElement>("inspector");
const timelineBody = $<HTMLDivElement>("timeline-body");
const timecodeEl = $<HTMLSpanElement>("timecode");
const durationEl = $<HTMLSpanElement>("duration");
const versionBadge = $<HTMLSpanElement>("version-badge");
const seekEl = $<HTMLInputElement>("seek");
const playBtn = $<HTMLButtonElement>("btn-play");
const fileInput = $<HTMLInputElement>("file-input");
const paletteEl = $<HTMLDivElement>("effects-palette");

// ==========================================================================
// Helpers
// ==========================================================================
function nextCtx(): CommandContext {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    actor: ACTOR,
    baseVersion: session.getVersion(),
  };
}

function commit(command: unknown): boolean {
  const op = session.dispatch(command);
  if (!op) {
    toast(session.getLastError()?.message ?? "Command rejected", true);
    return false;
  }
  updateUI();
  return true;
}

let toastTimer: number | undefined;
function toast(message: string, isError = false): void {
  const el = $<HTMLDivElement>("toast");
  el.textContent = message;
  el.className = `toast${isError ? " error" : ""}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.add("hidden"), 3200);
}

function formatTime(us: string | number): string {
  const totalMs = Math.round(Number(us) / 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function activeSequence(): Sequence | undefined {
  return session.getProject()?.sequences.find((s) => s.id === SEQUENCE_ID);
}

function findAsset(id: string): MediaAsset | undefined {
  return session.getProject()?.assets.find((a) => a.id === id);
}

function getParamNumber(
  effect: EffectInstance,
  name: string,
  fallback: number,
): number {
  const v = (effect.params as Record<string, unknown>)[name];
  return typeof v === "number" ? v : fallback;
}
function getParamString(
  effect: EffectInstance,
  name: string,
  fallback: string,
): string {
  const v = (effect.params as Record<string, unknown>)[name];
  return typeof v === "string" ? v : fallback;
}
function getParamBool(effect: EffectInstance, name: string): boolean {
  return (effect.params as Record<string, unknown>)[name] === true;
}

interface ClipLocation {
  clip: TimelineClip;
  track: Track;
}
function locateClip(clipId: string | null): ClipLocation | null {
  if (!clipId) return null;
  const seq = activeSequence();
  if (!seq) return null;
  for (const track of seq.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { clip, track };
  }
  return null;
}

function trackEndUs(track: Track): bigint {
  let end = 0n;
  for (const c of track.clips) {
    const e = BigInt(c.timelineStartUs) + BigInt(c.timelineDurationUs);
    if (e > end) end = e;
  }
  return end;
}

// ==========================================================================
// Seed the project
// ==========================================================================
function seed(): void {
  session.dispatch(
    buildCreateProject(nextCtx(), {
      projectId: PROJECT_ID,
      ownerId: "owner-1",
      name: "Untitled Project",
      settings: { defaultFrameRate: FRAME_RATE },
    }),
  );
  session.dispatch(
    buildCreateSequence(nextCtx(), {
      sequence: {
        id: SEQUENCE_ID,
        name: "Main",
        width: 1920,
        height: 1080,
        frameRate: FRAME_RATE,
      },
    }),
  );
  session.dispatch(
    buildAddTrack(nextCtx(), {
      sequenceId: SEQUENCE_ID,
      track: { id: VIDEO_TRACK, kind: "video", name: "Video", index: 0 },
    }),
  );
  session.dispatch(
    buildAddTrack(nextCtx(), {
      sequenceId: SEQUENCE_ID,
      track: { id: AUDIO_TRACK, kind: "audio", name: "Audio", index: 1 },
    }),
  );
}

// ==========================================================================
// Import media
// ==========================================================================
async function importFile(file: File): Promise<void> {
  const url = URL.createObjectURL(file);
  const kind: MediaAsset["kind"] = file.type.startsWith("video/")
    ? "video"
    : file.type.startsWith("audio/")
      ? "audio"
      : "image";

  let width = 1920;
  let height = 1080;
  let durationUs = "5000000"; // default 5s for images

  if (kind === "image") {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => undefined);
    width = img.naturalWidth || width;
    height = img.naturalHeight || height;
    mediaCache.set(url, img);
  } else {
    const el = document.createElement(kind === "video" ? "video" : "audio") as
      HTMLVideoElement | HTMLAudioElement;
    el.src = url;
    el.muted = true;
    el.preload = "metadata";
    await new Promise<void>((resolve) => {
      el.onloadedmetadata = () => resolve();
      el.onerror = () => resolve();
    });
    durationUs = String(
      Math.max(1, Math.round((el.duration || 5) * 1_000_000)),
    );
    if (el instanceof HTMLVideoElement) {
      width = el.videoWidth || width;
      height = el.videoHeight || height;
    }
    mediaCache.set(url, el as HTMLVideoElement);
  }

  const checksum = await sha256Hex(await file.arrayBuffer());
  const assetId = `asset-${crypto.randomUUID().slice(0, 8)}`;
  const metadata: MediaAsset["metadata"] = {
    fileSizeBytes: String(file.size),
    durationUs,
    frameRate: FRAME_RATE,
  };
  if (kind !== "audio") {
    metadata.width = width;
    metadata.height = height;
  }

  const registered = commit(
    buildRegisterAsset(nextCtx(), {
      asset: {
        id: assetId,
        projectId: PROJECT_ID,
        kind,
        originalUri: url,
        checksum,
        metadata,
        createdAt: new Date().toISOString(),
      },
    }),
  );
  if (registered) addAssetToTimeline(assetId, kind, durationUs);
}

async function importFiles(files: FileList | File[]): Promise<void> {
  for (const file of Array.from(files)) {
    if (/^(image|video|audio)\//.test(file.type)) await importFile(file);
  }
}

function addAssetToTimeline(
  assetId: string,
  kind: MediaAsset["kind"],
  durationUs: string,
  preferredTrackId?: string,
): void {
  const seq = activeSequence();
  if (!seq) return;
  const trackId =
    preferredTrackId ?? (kind === "audio" ? AUDIO_TRACK : VIDEO_TRACK);
  const track = seq.tracks.find((t) => t.id === trackId);
  if (!track) return;
  const startUs = trackEndUs(track).toString();
  const clipId = `clip-${crypto.randomUUID().slice(0, 8)}`;
  const added = commit(
    buildAddClip(nextCtx(), {
      sequenceId: SEQUENCE_ID,
      trackId,
      clip: {
        id: clipId,
        assetId,
        timelineStartUs: startUs,
        sourceInUs: "0",
        sourceOutUs: durationUs,
        playbackRate: { numerator: 1, denominator: 1 },
      },
    }),
  );
  if (added) selectClip(clipId);
}

/** Select a clip and move the playhead onto it, so the preview shows the clip
 * you are editing (effects/adjustments become visible immediately). */
function selectClip(clipId: string | null): void {
  selectedClipId = clipId;
  const loc = locateClip(clipId);
  if (loc) playback = seek(playback, loc.clip.timelineStartUs);
  updateUI();
}

// ==========================================================================
// Preview rendering
// ==========================================================================
function drawPreview(): void {
  if (rasterSession) {
    stageEmpty.style.display = "none";
    redrawRasterCanvas();
    return;
  }
  const cw = stageEl.clientWidth;
  const ch = stageEl.clientHeight;
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  cctx.clearRect(0, 0, cw, ch);

  const seq = activeSequence();
  const layers = seq ? resolveAtTime(seq, playback.currentTimeUs) : [];
  const visual = layers.filter((l) => {
    const a = findAsset(l.assetId);
    return a && a.kind !== "audio";
  });

  stageEmpty.style.display = visual.length === 0 ? "block" : "none";
  if (visual.length === 0) return;

  // Paint highest track index last (on top): resolve order is track order.
  for (const layer of [...visual].reverse()) {
    const loc = locateClip(layer.clipId);
    if (loc) drawLayer(loc.clip, layer.sourceTimeUs, cw, ch);
  }
}

function drawLayer(
  clip: TimelineClip,
  sourceTimeUs: string,
  cw: number,
  ch: number,
): void {
  const asset = findAsset(clip.assetId);
  if (!asset) return;
  const media = mediaCache.get(asset.originalUri);
  if (!media) return;

  let mw = asset.metadata.width ?? 1920;
  let mh = asset.metadata.height ?? 1080;
  if (media instanceof HTMLImageElement) {
    mw = media.naturalWidth || mw;
    mh = media.naturalHeight || mh;
  } else if (media instanceof HTMLVideoElement) {
    mw = media.videoWidth || mw;
    mh = media.videoHeight || mh;
    if (playback.playing === false) {
      const target = Number(sourceTimeUs) / 1_000_000;
      if (Math.abs(media.currentTime - target) > 0.05)
        media.currentTime = target;
    }
  }

  // Crop/reframe is a non-destructive effect: it narrows the source rect we
  // sample from, rather than touching the media itself.
  const cropFx = clip.effects.find(
    (e) => e.enabled && e.type === "transform.crop",
  );
  let sx = 0;
  let sy = 0;
  let sw = mw;
  let sh = mh;
  if (cropFx) {
    const p = cropFx.params as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    sx = p.x * mw;
    sy = p.y * mh;
    sw = Math.max(1, p.width * mw);
    sh = Math.max(1, p.height * mh);
  }

  const scale = Math.min(cw / sw, ch / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;

  const { filter, alpha, rotateDeg, flipX, flipY } = previewTransform(clip);

  // Background removal (color key) needs per-pixel work, so it runs on an
  // offscreen canvas whose result is drawn in place of the raw media.
  const bgFx = clip.effects.find(
    (e) => e.enabled && e.type === "fx.remove_background",
  );
  const drawable: CanvasImageSource = bgFx
    ? removeBackground(media, mw, mh, bgFx)
    : media;

  cctx.save();
  cctx.globalAlpha = alpha;
  cctx.filter = filter || "none";
  const ccx = dx + dw / 2;
  const ccy = dy + dh / 2;
  cctx.translate(ccx, ccy);
  if (rotateDeg) cctx.rotate((rotateDeg * Math.PI) / 180);
  if (flipX || flipY) cctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  cctx.drawImage(drawable, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  cctx.restore();

  drawOverlays(clip, dx, dy, dw, dh);
}

function previewTransform(clip: TimelineClip): {
  filter: string;
  alpha: number;
  rotateDeg: number;
  flipX: boolean;
  flipY: boolean;
} {
  const parts: string[] = [];
  let alpha = 1;
  let rotateDeg = 0;
  let flipX = false;
  let flipY = false;

  for (const fx of clip.effects) {
    if (!fx.enabled) continue;
    switch (fx.type) {
      case "color.brightness":
        parts.push(
          `brightness(${(getParamNumber(fx, "amount", 0) + 1) * 100}%)`,
        );
        break;
      case "color.contrast":
        parts.push(`contrast(${getParamNumber(fx, "amount", 1) * 100}%)`);
        break;
      case "color.saturate":
        parts.push(`saturate(${getParamNumber(fx, "amount", 1) * 100}%)`);
        break;
      case "color.exposure":
        parts.push(
          `brightness(${Math.pow(2, getParamNumber(fx, "amount", 0)) * 100}%)`,
        );
        break;
      case "color.hue_rotate":
        parts.push(`hue-rotate(${getParamNumber(fx, "angleDegrees", 0)}deg)`);
        break;
      case "color.grayscale":
        parts.push(`grayscale(${getParamNumber(fx, "amount", 1) * 100}%)`);
        break;
      case "color.sepia":
        parts.push(`sepia(${getParamNumber(fx, "amount", 1) * 100}%)`);
        break;
      case "color.invert":
        parts.push(`invert(${getParamNumber(fx, "amount", 1) * 100}%)`);
        break;
      case "blur.gaussian":
        parts.push(`blur(${getParamNumber(fx, "radiusPx", 0)}px)`);
        break;
      case "photo.portrait_blur":
        parts.push(
          `blur(${getParamNumber(fx, "blurRadiusPx", 0) * getParamNumber(fx, "bokehStrength", 0.4)}px)`,
        );
        break;
      case "transform.opacity":
        alpha *= getParamNumber(fx, "opacity", 1);
        break;
      case "transform.rotate":
        rotateDeg += getParamNumber(fx, "angleDegrees", 0);
        break;
      case "transform.flip":
        if (getParamBool(fx, "horizontal")) flipX = !flipX;
        if (getParamBool(fx, "vertical")) flipY = !flipY;
        break;
      default:
        break;
    }
  }
  return { filter: parts.join(" "), alpha, rotateDeg, flipX, flipY };
}

function drawOverlays(
  clip: TimelineClip,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  for (const fx of clip.effects) {
    if (!fx.enabled) continue;
    if (fx.type === "color.vignette") {
      const amount = getParamNumber(fx, "amount", 0.5);
      const grad = cctx.createRadialGradient(
        dx + dw / 2,
        dy + dh / 2,
        Math.min(dw, dh) * 0.3,
        dx + dw / 2,
        dy + dh / 2,
        Math.max(dw, dh) * 0.7,
      );
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, `rgba(0,0,0,${amount})`);
      cctx.fillStyle = grad;
      cctx.fillRect(dx, dy, dw, dh);
    } else if (fx.type === "color.tint" || fx.type === "color.duotone") {
      const color =
        fx.type === "color.tint"
          ? getParamString(fx, "colorHex", "#ff5a00")
          : getParamString(fx, "highlightsHex", "#ff5a00");
      const amount =
        fx.type === "color.tint" ? getParamNumber(fx, "amount", 0.2) : 0.3;
      cctx.save();
      cctx.globalAlpha = amount;
      cctx.globalCompositeOperation = "overlay";
      cctx.fillStyle = color;
      cctx.fillRect(dx, dy, dw, dh);
      cctx.restore();
    } else if (fx.type === "fx.retro_noise") {
      const spacing = getParamNumber(fx, "scanlineSpacing", 6);
      cctx.save();
      cctx.globalAlpha = getParamNumber(fx, "noiseAmount", 0.25);
      cctx.fillStyle = "#000";
      for (let y = dy; y < dy + dh; y += spacing) cctx.fillRect(dx, y, dw, 1);
      cctx.restore();
    } else if (fx.type === "fx.border") {
      const w = getParamNumber(fx, "borderWidthPx", 12);
      cctx.strokeStyle = getParamString(fx, "borderColorHex", "#ffffff");
      cctx.lineWidth = w;
      cctx.strokeRect(dx + w / 2, dy + w / 2, dw - w, dh - w);
    }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) return [0, 255, 0];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

function cornerKey(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): [number, number, number] {
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const i of corners) {
    r += data[i]!;
    g += data[i + 1]!;
    b += data[i + 2]!;
  }
  return [Math.round(r / 4), Math.round(g / 4), Math.round(b / 4)];
}

/** Color-key background removal: pixels close to the key color become
 * transparent, with a soft edge. Deterministic; no ML model. */
function removeBackground(
  media: CanvasImageSource,
  mw: number,
  mh: number,
  fx: EffectInstance,
): HTMLCanvasElement {
  const off = document.createElement("canvas");
  off.width = mw;
  off.height = mh;
  const octx = off.getContext("2d")!;
  octx.drawImage(media, 0, 0, mw, mh);
  const image = octx.getImageData(0, 0, mw, mh);
  const d = image.data;

  const key = getParamBool(fx, "auto")
    ? cornerKey(d, mw, mh)
    : hexToRgb(getParamString(fx, "keyColorHex", "#00ff00"));
  const MAX = Math.sqrt(3) * 255;
  const threshold = getParamNumber(fx, "threshold", 0.12) * MAX;
  const softness = getParamNumber(fx, "softness", 0.1) * MAX;

  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.hypot(
      d[i]! - key[0],
      d[i + 1]! - key[1],
      d[i + 2]! - key[2],
    );
    if (dist <= threshold) {
      d[i + 3] = 0;
    } else if (softness > 0 && dist <= threshold + softness) {
      d[i + 3] = Math.round(d[i + 3]! * ((dist - threshold) / softness));
    }
  }
  octx.putImageData(image, 0, 0);
  return off;
}

// ==========================================================================
// Timeline rendering
// ==========================================================================
function renderTimeline(): void {
  const seq = activeSequence();
  timelineBody.innerHTML = "";
  if (!seq) return;

  const durationUs = sequenceDurationUs(seq);
  const laneWidth = Math.max(600, usToPixels(durationUs, zoom) + 200);

  for (const track of seq.tracks) {
    const row = document.createElement("div");
    row.className = "track-row";

    const head = document.createElement("div");
    head.className = "track-head";
    head.textContent = `${track.name} (${track.kind})`;
    row.appendChild(head);

    const lane = document.createElement("div");
    lane.className = "track-lane";
    lane.style.minWidth = `${laneWidth}px`;
    lane.addEventListener("dragover", (e) => {
      e.preventDefault();
      lane.classList.add("dragover");
    });
    lane.addEventListener("dragleave", () => lane.classList.remove("dragover"));
    lane.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      lane.classList.remove("dragover");
      const assetId = e.dataTransfer?.getData("application/x-asset-id");
      if (assetId) {
        const asset = findAsset(assetId);
        if (asset) {
          addAssetToTimeline(
            asset.id,
            asset.kind,
            asset.metadata.durationUs ?? "5000000",
            track.id,
          );
        }
      } else if (e.dataTransfer?.files.length) {
        void importFiles(e.dataTransfer.files);
      }
    });

    for (const clip of track.clips) {
      const el = document.createElement("div");
      el.className = `clip${track.kind === "audio" ? " audio" : ""}${
        clip.id === selectedClipId ? " selected" : ""
      }`;
      el.style.left = `${usToPixels(clip.timelineStartUs, zoom)}px`;
      el.style.width = `${Math.max(24, usToPixels(clip.timelineDurationUs, zoom))}px`;
      const asset = findAsset(clip.assetId);
      el.textContent = asset ? assetName(asset) : clip.id;
      el.addEventListener("pointerdown", (e) => startClipDrag(e, clip, track));
      lane.appendChild(el);
    }
    row.appendChild(lane);
    timelineBody.appendChild(row);
  }

  const playhead = document.createElement("div");
  playhead.className = "playhead";
  playhead.style.left = `${90 + usToPixels(playback.currentTimeUs, zoom)}px`;
  timelineBody.appendChild(playhead);
}

function assetName(asset: MediaAsset): string {
  const parts = asset.originalUri.split("/");
  return parts[parts.length - 1] || asset.id;
}

// Drag a clip horizontally to move it (dispatches timeline.move_clip).
function startClipDrag(
  e: PointerEvent,
  clip: TimelineClip,
  track: Track,
): void {
  e.preventDefault();
  selectClip(clip.id);
  const startX = e.clientX;
  let moved = false;

  const onMove = (ev: PointerEvent): void => {
    if (Math.abs(ev.clientX - startX) > 3) moved = true;
  };
  const onUp = (ev: PointerEvent): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (!moved) return;
    const drag = resolveClipDrag({
      kind: "move",
      sequenceId: SEQUENCE_ID,
      clip,
      targetTrackId: track.id,
      deltaPixels: ev.clientX - startX,
      pixelsPerSecond: zoom,
    });
    if (drag.commandType === "timeline.move_clip") {
      commit(buildMoveClip(nextCtx(), drag.payload));
    }
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

// ==========================================================================
// Inspector rendering
// ==========================================================================
function renderInspector(): void {
  if (rasterSession) {
    renderRasterPanel();
    return;
  }
  const loc = locateClip(selectedClipId);
  inspectorEl.innerHTML = "";
  if (!loc) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Select a clip to edit its effects and audio.";
    inspectorEl.appendChild(p);
    return;
  }
  const { clip } = loc;
  const asset = findAsset(clip.assetId);

  if (mode === "photo" && asset?.kind === "image") {
    const editBtn = document.createElement("button");
    editBtn.className = "tool primary";
    editBtn.style.width = "100%";
    editBtn.style.marginBottom = "12px";
    editBtn.textContent = "🖌 Edit Photo (Brush, Crop, Clone…)";
    editBtn.addEventListener("click", () => enterRasterMode(clip.id));
    inspectorEl.appendChild(editBtn);
  }
  if (mode === "video" && asset?.kind === "video") {
    const editFrameBtn = document.createElement("button");
    editFrameBtn.className = "tool primary";
    editFrameBtn.style.width = "100%";
    editFrameBtn.style.marginBottom = "12px";
    editFrameBtn.textContent = "🎞 Edit Current Frame (Brush, Clone, Wand…)";
    editFrameBtn.addEventListener("click", () => void enterRasterModeFromVideoFrame(clip.id));
    inspectorEl.appendChild(editFrameBtn);
  }

  // --- Effects ---
  const fxSection = section("Effects");
  for (const fx of clip.effects) {
    const spec = effectSpec(fx.type);
    const header = document.createElement("div");
    header.className = "effect-row";
    const name = document.createElement("span");
    name.className = "fx-name";
    name.textContent = spec?.label ?? fx.type;
    const remove = document.createElement("button");
    remove.className = "mini";
    remove.textContent = "Remove";
    remove.addEventListener("click", () =>
      commit(
        buildRemoveEffect(nextCtx(), {
          sequenceId: SEQUENCE_ID,
          clipId: clip.id,
          effectId: fx.id,
        }),
      ),
    );
    header.append(name, remove);
    fxSection.appendChild(header);

    if (spec) {
      for (const p of spec.params) {
        fxSection.appendChild(paramControl(clip.id, fx, spec, p));
      }
    }
  }

  const addWrap = document.createElement("div");
  addWrap.className = "control";
  const select = document.createElement("select");
  const placeholder = new Option("＋ Add effect…", "");
  select.appendChild(placeholder);
  for (const spec of EFFECTS.filter((s) => s.modes.includes(mode))) {
    select.appendChild(new Option(spec.label, spec.type));
  }
  select.addEventListener("change", () => {
    if (select.value) addEffectByType(select.value as EffectType);
  });
  addWrap.appendChild(select);
  fxSection.appendChild(addWrap);
  inspectorEl.appendChild(fxSection);

  // --- Audio ---
  const audioSection = section("Audio");
  audioSection.appendChild(
    sliderControl(
      `Gain ${clip.audioGainDb.toFixed(1)} dB`,
      -60,
      12,
      0.5,
      clip.audioGainDb,
      (v) =>
        commit(
          buildSetClipAudioGain(nextCtx(), {
            sequenceId: SEQUENCE_ID,
            clipId: clip.id,
            gainDb: v,
          }),
        ),
    ),
  );
  audioSection.appendChild(
    sliderControl(
      `Pan ${clip.audioPan.toFixed(2)}`,
      -1,
      1,
      0.05,
      clip.audioPan,
      (v) =>
        commit(
          buildSetClipAudioPan(nextCtx(), {
            sequenceId: SEQUENCE_ID,
            clipId: clip.id,
            pan: v,
          }),
        ),
    ),
  );
  inspectorEl.appendChild(audioSection);
}

function section(title: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "insp-section";
  const h = document.createElement("h4");
  h.textContent = title;
  el.appendChild(h);
  return el;
}

function paramControl(
  clipId: string,
  fx: EffectInstance,
  spec: EffectSpec,
  p: ParamSpec,
): HTMLElement {
  const update = (value: number | string | boolean): void => {
    const params: Record<string, number | string | boolean> = {
      ...(fx.params as Record<string, number | string | boolean>),
    };
    params[p.name] = value;
    commit(
      buildUpdateEffectParams(nextCtx(), {
        sequenceId: SEQUENCE_ID,
        clipId,
        effectId: fx.id,
        params,
      }),
    );
  };

  if (p.kind === "toggle") {
    const wrap = document.createElement("label");
    wrap.className = "control";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = getParamBool(fx, p.name);
    cb.addEventListener("change", () => update(cb.checked));
    wrap.append(` ${p.label} `, cb);
    return wrap;
  }
  if (p.kind === "color") {
    const wrap = document.createElement("div");
    wrap.className = "control";
    const label = document.createElement("label");
    label.textContent = p.label;
    const input = document.createElement("input");
    input.type = "color";
    input.value = getParamString(fx, p.name, String(p.def));
    input.addEventListener("input", () => update(input.value));
    wrap.append(label, input);
    return wrap;
  }
  return sliderControl(
    p.label,
    p.min ?? 0,
    p.max ?? 1,
    p.step ?? 0.05,
    getParamNumber(fx, p.name, Number(p.def)),
    update,
  );
}

function sliderControl(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onChange: (v: number) => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "control";
  const lab = document.createElement("label");
  const name = document.createElement("span");
  name.textContent = label;
  const val = document.createElement("span");
  val.textContent = value.toFixed(2);
  lab.append(name, val);
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => {
    val.textContent = Number(input.value).toFixed(2);
  });
  input.addEventListener("change", () => onChange(Number(input.value)));
  wrap.append(lab, input);
  return wrap;
}

// ==========================================================================
// History
// ==========================================================================
function renderHistory(): void {
  historyEl.innerHTML = "";
  const ops = session.getState().operationLog;
  ops.forEach((op, i) => {
    const el = document.createElement("div");
    el.className = `history-item${i === ops.length - 1 ? " current" : ""}`;
    el.textContent = `${i + 1}. ${op.command.commandType}`;
    historyEl.appendChild(el);
  });
}

function addEffectByType(type: EffectType): void {
  if (!selectedClipId) {
    toast("Select a clip on the timeline first, then add an effect.", true);
    return;
  }
  const spec = effectSpec(type);
  if (!spec) return;
  const effect = {
    id: `fx-${crypto.randomUUID().slice(0, 8)}`,
    type: spec.type,
    enabled: true,
    params: defaultParams(spec),
  } as unknown as EffectInstance;
  if (
    commit(
      buildAddEffect(nextCtx(), {
        sequenceId: SEQUENCE_ID,
        clipId: selectedClipId,
        effect,
      }),
    )
  ) {
    toast(`Added ${spec.label}. Adjust it in the Inspector →`);
  }
}

function renderEffectsPalette(): void {
  paletteEl.innerHTML = "";
  for (const spec of EFFECTS.filter((s) => s.modes.includes(mode))) {
    const chip = document.createElement("button");
    chip.className = "fx-chip";
    chip.textContent = spec.label;
    chip.disabled = selectedClipId === null;
    chip.title = selectedClipId
      ? `Add ${spec.label} to the selected clip`
      : "Select a clip first";
    chip.addEventListener("click", () => addEffectByType(spec.type));
    paletteEl.appendChild(chip);
  }
}

function renderMedia(): void {
  mediaListEl.innerHTML = "";
  for (const asset of session.getProject()?.assets ?? []) {
    const el = document.createElement("div");
    el.className = "media-item";
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("application/x-asset-id", asset.id);
      e.dataTransfer?.setData("text/plain", asset.id);
    });
    const thumb = document.createElement("div");
    thumb.className = "media-thumb";
    if (asset.kind === "image" || asset.kind === "video") {
      thumb.style.backgroundImage = `url("${asset.originalUri}")`;
    } else {
      thumb.classList.add("audio");
      thumb.textContent = "🔊";
    }
    const meta = document.createElement("div");
    meta.className = "media-meta";
    const name = document.createElement("span");
    name.className = "media-name";
    name.textContent = assetName(asset);
    const sub = document.createElement("span");
    sub.className = "media-sub";
    sub.textContent = `${asset.kind} · ${formatTime(asset.metadata.durationUs ?? "0")}`;
    meta.append(name, sub);
    const add = document.createElement("span");
    add.className = "media-add";
    add.textContent = "＋";
    add.title = "Add to timeline";
    el.append(thumb, meta, add);
    el.addEventListener("click", () =>
      addAssetToTimeline(
        asset.id,
        asset.kind,
        asset.metadata.durationUs ?? "5000000",
      ),
    );
    mediaListEl.appendChild(el);
  }
}

// ==========================================================================
// Transport
// ==========================================================================
function syncPlaybackDuration(): void {
  const seq = activeSequence();
  const durationUs = seq ? sequenceDurationUs(seq) : "0";
  playback = { ...playback, durationUs };
  durationEl.textContent = `/ ${formatTime(durationUs)}`;
}

function syncTransport(): void {
  timecodeEl.textContent = formatTime(playback.currentTimeUs);
  playBtn.textContent = playback.playing ? "⏸" : "▶";
  const dur = Number(playback.durationUs);
  seekEl.value = String(
    dur > 0 ? Math.round((Number(playback.currentTimeUs) / dur) * 1000) : 0,
  );
}

let lastFrame = performance.now();
function animate(now: number): void {
  const dt = now - lastFrame;
  lastFrame = now;
  if (playback.playing) {
    playback = tick(playback, String(Math.round(dt * 1000)));
    syncTransport();
    drawPreview();
    renderTimeline();
  }
  requestAnimationFrame(animate);
}

function stepFrame(delta: number): void {
  const frame = timeToFrameIndex(playback.currentTimeUs, FRAME_RATE) + delta;
  const clamped = Math.max(0, frame);
  playback = seek(playback, frameToStartTimeUs(clamped, FRAME_RATE));
  syncTransport();
  drawPreview();
  renderTimeline();
}

// ==========================================================================
// UI orchestration
// ==========================================================================
function updateUI(): void {
  versionBadge.textContent = `v${session.getVersion()}`;
  syncPlaybackDuration();
  renderMedia();
  renderEffectsPalette();
  renderHistory();
  renderTimeline();
  renderInspector();
  syncTransport();
  drawPreview();
}

function setMode(next: "video" | "photo"): void {
  mode = next;
  $("mode-video").classList.toggle("active", mode === "video");
  $("mode-photo").classList.toggle("active", mode === "photo");
  document.body.dataset["mode"] = mode;
  renderInspector();
  renderEffectsPalette();
}

// ==========================================================================
// Theme: dark / light / system, plus customizable color themes
// ==========================================================================
type ThemePreference = "dark" | "light" | "system";
const THEME_STORAGE_KEY = "director-theme";
const THEME_SELECTION_KEY = "director-theme-selection";
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: light)");

function resolveTheme(pref: ThemePreference): "dark" | "light" {
  return pref === "system" ? (systemThemeQuery.matches ? "light" : "dark") : pref;
}

function currentThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "dark" || stored === "light" || stored === "system"
    ? stored
    : "system";
}

/** "default" (plain dark/light), a preset key, or `custom:<name>`. */
function currentThemeSelection(): string {
  return localStorage.getItem(THEME_SELECTION_KEY) ?? "default";
}

function setThemeSelection(selection: string): void {
  localStorage.setItem(THEME_SELECTION_KEY, selection);
}

function resolveSelectionTokens(selection: string): ThemeTokens | null {
  if (selection === "default") return null;
  if (selection in PRESETS) return PRESETS[selection] ?? null;
  if (selection.startsWith("custom:")) {
    const name = selection.slice("custom:".length);
    const entry = loadCustomThemes().find((c) => c.name === name);
    if (!entry) return null;
    return deriveTheme(
      entry.seeds.bg,
      entry.seeds.panel,
      entry.seeds.text,
      entry.seeds.accent,
    );
  }
  return null;
}

function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveTheme(pref));
  root.setAttribute("data-theme-pref", pref);
  localStorage.setItem(THEME_STORAGE_KEY, pref);
  for (const id of ["theme-dark", "theme-light", "theme-system"] as const) {
    $(id).classList.toggle("active", id === `theme-${pref}`);
  }
}

function applyThemeSelection(selection: string): void {
  setThemeSelection(selection);
  applyThemeTokens(resolveSelectionTokens(selection));
  renderThemePanel();
}

function renderThemePanel(): void {
  const selection = currentThemeSelection();
  const grid = $<HTMLDivElement>("theme-preset-grid");
  grid.innerHTML = "";

  const defaultSwatch = document.createElement("button");
  defaultSwatch.type = "button";
  defaultSwatch.className = `theme-swatch${selection === "default" ? " active" : ""}`;
  defaultSwatch.style.background = "var(--accent-grad)";
  defaultSwatch.title = "Default (follows dark/light)";
  defaultSwatch.innerHTML = `<span class="theme-swatch-label">Default</span>`;
  defaultSwatch.addEventListener("click", () => applyThemeSelection("default"));
  grid.appendChild(defaultSwatch);

  for (const [key, tokens] of Object.entries(PRESETS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `theme-swatch${selection === key ? " active" : ""}`;
    btn.style.background = `linear-gradient(135deg, ${tokens.bg}, ${tokens.accent})`;
    btn.title = PRESET_LABELS[key] ?? key;
    btn.innerHTML = `<span class="theme-swatch-label">${PRESET_LABELS[key] ?? key}</span>`;
    btn.addEventListener("click", () => applyThemeSelection(key));
    grid.appendChild(btn);
  }

  const list = $<HTMLDivElement>("theme-custom-list");
  list.innerHTML = "";
  for (const entry of loadCustomThemes()) {
    const selectionKey = `custom:${entry.name}`;
    const row = document.createElement("div");
    row.className = `theme-custom-item${selection === selectionKey ? " active" : ""}`;
    const dot = document.createElement("span");
    dot.className = "theme-custom-swatch";
    dot.style.background = entry.seeds.accent;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = entry.name;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "mini";
    del.textContent = "✕";
    del.title = "Delete theme";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteCustomTheme(entry.name);
      if (currentThemeSelection() === selectionKey) applyThemeSelection("default");
      renderThemePanel();
    });
    row.append(dot, name, del);
    row.addEventListener("click", () => applyThemeSelection(selectionKey));
    list.appendChild(row);
  }
}

function initTheme(): void {
  applyTheme(currentThemePreference());
  applyThemeTokens(resolveSelectionTokens(currentThemeSelection()));
  renderThemePanel();
  // If the user is following the system theme, react to OS changes live.
  systemThemeQuery.addEventListener("change", () => {
    if (currentThemePreference() === "system") applyTheme("system");
  });
}

function bindThemePicker(): void {
  const toggleBtn = $<HTMLButtonElement>("btn-theme-picker");
  const panel = $<HTMLDivElement>("theme-panel");
  const form = $<HTMLFormElement>("theme-form");
  const newBtn = $<HTMLButtonElement>("btn-theme-new");
  const cancelBtn = $<HTMLButtonElement>("btn-theme-cancel");
  const nameInput = $<HTMLInputElement>("theme-name");
  const seedBg = $<HTMLInputElement>("seed-bg");
  const seedPanel = $<HTMLInputElement>("seed-panel");
  const seedText = $<HTMLInputElement>("seed-text");
  const seedAccent = $<HTMLInputElement>("seed-accent");

  const closePanel = (): void => {
    panel.classList.add("hidden");
    form.classList.add("hidden");
    toggleBtn.setAttribute("aria-expanded", "false");
  };

  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = panel.classList.contains("hidden");
    if (willOpen) renderThemePanel();
    panel.classList.toggle("hidden", !willOpen);
    toggleBtn.setAttribute("aria-expanded", String(willOpen));
  });
  document.addEventListener("click", (e) => {
    if (!panel.contains(e.target as Node) && e.target !== toggleBtn) {
      closePanel();
    }
  });

  const previewSeeds = (): void => {
    const tokens: ThemeTokens = deriveTheme(
      seedBg.value,
      seedPanel.value,
      seedText.value,
      seedAccent.value,
    );
    applyThemeTokens(tokens);
  };

  newBtn.addEventListener("click", () => {
    if (loadCustomThemes().length >= MAX_CUSTOM_THEMES) {
      toast(`You can save up to ${MAX_CUSTOM_THEMES} custom themes.`, true);
      return;
    }
    form.classList.remove("hidden");
    nameInput.focus();
    previewSeeds();
  });
  for (const input of [seedBg, seedPanel, seedText, seedAccent]) {
    input.addEventListener("input", previewSeeds);
  }
  cancelBtn.addEventListener("click", () => {
    form.classList.add("hidden");
    applyThemeTokens(resolveSelectionTokens(currentThemeSelection()));
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    const saved = upsertCustomTheme({
      name,
      seeds: {
        bg: seedBg.value,
        panel: seedPanel.value,
        text: seedText.value,
        accent: seedAccent.value,
      },
    });
    if (!saved) {
      toast(`You can save up to ${MAX_CUSTOM_THEMES} custom themes.`, true);
      return;
    }
    form.classList.add("hidden");
    nameInput.value = "";
    applyThemeSelection(`custom:${name}`);
    toast(`Saved theme "${name}".`);
  });
}

// ==========================================================================
// Raster photo editing (Photo mode only)
//
// A working pixel buffer, edited with real classical algorithms from
// @director/raster-tools (flood-fill selection, polygon lasso, brush/eraser/
// clone stamping, unsharp mask, harmonic diffusion "Smart Fill", color-key
// background removal). This lives entirely outside the deterministic command
// engine — like playback and export state — so individual brush strokes never
// enter the operation log. "Apply" is the only path back into the project,
// and it goes through the real `asset.register` command with a genuine
// SHA-256 of the flattened PNG bytes; nothing here bypasses validation.
// ==========================================================================

const RASTER_TOOLS: Array<{ id: RasterTool; icon: string; label: string }> = [
  { id: "move", icon: "✥", label: "Move" },
  { id: "crop", icon: "⬚", label: "Crop" },
  { id: "transform", icon: "⇲", label: "Transform" },
  { id: "brush", icon: "🖌", label: "Brush" },
  { id: "eraser", icon: "⌫", label: "Eraser" },
  { id: "clone", icon: "⎘", label: "Clone Stamp" },
  { id: "lasso", icon: "➰", label: "Lasso" },
  { id: "wand", icon: "✨", label: "Magic Wand" },
  { id: "sharpen", icon: "◆", label: "Sharpen" },
  { id: "smartfill", icon: "🩹", label: "Smart Fill" },
  { id: "bgremove", icon: "🪄", label: "Remove Background" },
];

function hexToRgbColor(hex: string): { r: number; g: number; b: number } {
  const [r, g, b] = hexToRgb(hex);
  return { r, g, b };
}

function startRasterSession(clipId: string, session: RasterSession): void {
  rasterSession = session;
  rasterEditingClipId = clipId;
  rasterTool = "brush";
  rasterSelection = null;
  rasterSelectionOverlay = null;
  rasterDrag = null;
  cloneSource = null;
  playback = pause(playback);
  syncTransport();
  bindRasterCanvasEvents();
  updateUI();
}

function enterRasterMode(clipId: string): void {
  const loc = locateClip(clipId);
  if (!loc) return;
  const asset = findAsset(loc.clip.assetId);
  if (!asset || asset.kind !== "image") {
    toast("Only photo (image) clips can be edited here.", true);
    return;
  }
  const media = mediaCache.get(asset.originalUri);
  if (!media || !(media instanceof HTMLImageElement)) {
    toast("This photo hasn't finished loading yet.", true);
    return;
  }
  const width = media.naturalWidth || asset.metadata.width || 1;
  const height = media.naturalHeight || asset.metadata.height || 1;
  startRasterSession(clipId, RasterSession.fromSource(media, width, height));
}

/** Wait until the video element has actually seeked to `targetSeconds` before
 * reading pixels — `currentTime` assignment is async, so capturing
 * immediately could grab the previous frame. */
function seekVideoFrame(video: HTMLVideoElement, targetSeconds: number): Promise<void> {
  if (Math.abs(video.currentTime - targetSeconds) < 0.02) return Promise.resolve();
  return new Promise((resolve) => {
    const onSeeked = (): void => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = targetSeconds;
  });
}

/** Extract the exact video frame under the playhead into the same raster
 * editor used for photos — a "same pattern" video editing entry: no new
 * pixel algorithms, just a different frame source. */
async function enterRasterModeFromVideoFrame(clipId: string): Promise<void> {
  const loc = locateClip(clipId);
  if (!loc) return;
  const asset = findAsset(loc.clip.assetId);
  if (!asset || asset.kind !== "video") {
    toast("Only video clips can extract a frame here.", true);
    return;
  }
  const media = mediaCache.get(asset.originalUri);
  if (!media || !(media instanceof HTMLVideoElement)) {
    toast("This video hasn't finished loading yet.", true);
    return;
  }
  const seq = activeSequence();
  const layer = seq
    ? resolveAtTime(seq, playback.currentTimeUs).find((l) => l.clipId === clipId)
    : undefined;
  if (!layer) {
    toast("Move the playhead onto this clip first.", true);
    return;
  }

  await seekVideoFrame(media, Number(layer.sourceTimeUs) / 1_000_000);
  const width = media.videoWidth || asset.metadata.width || 1;
  const height = media.videoHeight || asset.metadata.height || 1;
  startRasterSession(clipId, RasterSession.fromSource(media, width, height));
}

function exitRasterMode(): void {
  rasterSession = null;
  rasterEditingClipId = null;
  rasterSelection = null;
  rasterSelectionOverlay = null;
  rasterDrag = null;
  cloneSource = null;
  unbindRasterCanvasEvents();
  canvas.classList.remove("raster-active");
  canvas.style.transform = "";
  $("raster-rail").classList.add("hidden");
  updateUI();
}

function bindRasterCanvasEvents(): void {
  canvas.addEventListener("pointerdown", rasterPointerDown);
  canvas.addEventListener("pointermove", rasterPointerMove);
  window.addEventListener("pointerup", rasterPointerUp);
  canvas.classList.add("raster-active");
}

function unbindRasterCanvasEvents(): void {
  canvas.removeEventListener("pointerdown", rasterPointerDown);
  canvas.removeEventListener("pointermove", rasterPointerMove);
  window.removeEventListener("pointerup", rasterPointerUp);
}

function paintStrokePoint(x: number, y: number): void {
  if (!rasterSession) return;
  const isEraser = rasterTool === "eraser";
  const size = isEraser ? rasterOptions.eraserSize : rasterOptions.brushSize;
  const opacity = isEraser ? rasterOptions.eraserOpacity : rasterOptions.brushOpacity;
  const hardness = isEraser ? rasterOptions.eraserHardness : rasterOptions.brushHardness;
  const color = hexToRgbColor(rasterOptions.brushColor);
  stampBrush(
    rasterSession.image,
    x,
    y,
    size / 2,
    { ...color, a: 1 },
    opacity,
    isEraser ? "erase" : "paint",
    hardness,
  );
  redrawRasterCanvas();
}

function cloneStampPoint(x: number, y: number): void {
  if (!rasterSession || !cloneSource || !rasterDrag || rasterDrag.kind !== "clone") return;
  const offsetX = cloneSource.x - rasterDrag.anchorDestX;
  const offsetY = cloneSource.y - rasterDrag.anchorDestY;
  cloneStamp(
    rasterSession.image,
    rasterDrag.sourceSnapshot,
    x + offsetX,
    y + offsetY,
    x,
    y,
    rasterOptions.cloneSize / 2,
    rasterOptions.cloneOpacity,
    rasterOptions.cloneHardness,
  );
  redrawRasterCanvas();
}

function buildSelectionOverlay(mask: Mask): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = mask.width;
  c.height = mask.height;
  const ctx = c.getContext("2d")!;
  const imageData = ctx.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i++) {
    imageData.data[i * 4] = 124;
    imageData.data[i * 4 + 1] = 92;
    imageData.data[i * 4 + 2] = 255;
    imageData.data[i * 4 + 3] = mask.data[i]!;
  }
  ctx.putImageData(imageData, 0, 0);
  return c;
}

function setRasterSelection(mask: Mask | null): void {
  rasterSelection = mask;
  rasterSelectionOverlay = mask ? buildSelectionOverlay(mask) : null;
  redrawRasterCanvas();
  renderRasterPanel();
}

function redrawRasterCanvas(): void {
  if (!rasterSession) return;
  rasterSession.drawTo(canvas);
  const ctx = canvas.getContext("2d")!;

  if (rasterSelectionOverlay) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.drawImage(rasterSelectionOverlay, 0, 0);
    ctx.restore();
  }
  if (rasterDrag?.kind === "crop") {
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(
      rasterDrag.rect.x,
      rasterDrag.rect.y,
      rasterDrag.rect.width,
      rasterDrag.rect.height,
    );
    ctx.restore();
  }
  if (rasterDrag?.kind === "lasso" && rasterDrag.points.length > 1) {
    ctx.save();
    ctx.strokeStyle = "#7c5cff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const [first, ...rest] = rasterDrag.points;
    ctx.moveTo(first!.x, first!.y);
    for (const p of rest) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
  }
}

function rasterPointerDown(e: PointerEvent): void {
  if (!rasterSession) return;
  e.preventDefault();
  const { x, y } = canvasPointToImage(canvas, e.clientX, e.clientY);
  switch (rasterTool) {
    case "brush":
    case "eraser":
      rasterSession.snapshot();
      rasterDrag = { kind: "stroke" };
      paintStrokePoint(x, y);
      break;
    case "clone":
      if (e.altKey) {
        cloneSource = { x, y };
        toast("Clone source set — drag elsewhere to paint.");
        break;
      }
      if (!cloneSource) {
        toast("Alt/Option-click first to set the clone source.", true);
        break;
      }
      rasterSession.snapshot();
      rasterDrag = {
        kind: "clone",
        anchorDestX: x,
        anchorDestY: y,
        sourceSnapshot: cloneRasterImage(rasterSession.image),
      };
      cloneStampPoint(x, y);
      break;
    case "lasso":
      rasterDrag = { kind: "lasso", points: [{ x, y }] };
      break;
    case "wand": {
      const mask = floodFillMask(
        rasterSession.image,
        Math.round(x),
        Math.round(y),
        rasterOptions.wandTolerance,
        rasterOptions.wandContiguous,
      );
      setRasterSelection(mask);
      break;
    }
    case "crop":
      rasterDrag = { kind: "crop", startX: x, startY: y, rect: { x, y, width: 0, height: 0 } };
      break;
    case "move":
      rasterDrag = { kind: "move", startClientX: e.clientX, startClientY: e.clientY };
      break;
    default:
      break;
  }
  redrawRasterCanvas();
}

function rasterPointerMove(e: PointerEvent): void {
  if (!rasterSession || !rasterDrag) return;
  const { x, y } = canvasPointToImage(canvas, e.clientX, e.clientY);
  switch (rasterDrag.kind) {
    case "stroke":
      paintStrokePoint(x, y);
      break;
    case "clone":
      cloneStampPoint(x, y);
      break;
    case "lasso":
      rasterDrag.points.push({ x, y });
      redrawRasterCanvas();
      break;
    case "crop":
      rasterDrag.rect = {
        x: Math.min(rasterDrag.startX, x),
        y: Math.min(rasterDrag.startY, y),
        width: Math.abs(x - rasterDrag.startX),
        height: Math.abs(y - rasterDrag.startY),
      };
      redrawRasterCanvas();
      break;
    case "move": {
      canvas.style.transform = `translate(${e.clientX - rasterDrag.startClientX}px, ${e.clientY - rasterDrag.startClientY}px)`;
      break;
    }
    default:
      break;
  }
}

function rasterPointerUp(e: PointerEvent): void {
  if (!rasterSession || !rasterDrag) return;
  const drag = rasterDrag;
  if (drag.kind === "lasso") {
    if (drag.points.length >= 3) {
      setRasterSelection(
        polygonMask(rasterSession.image.width, rasterSession.image.height, drag.points),
      );
    }
    rasterDrag = null;
  } else if (drag.kind === "crop") {
    // Keep the pending rect alive so the panel's Apply/Cancel can act on it.
    renderRasterPanel();
    return;
  } else if (drag.kind === "move") {
    const rect = canvas.getBoundingClientRect();
    const scaleX = rasterSession.image.width / rect.width;
    const scaleY = rasterSession.image.height / rect.height;
    const dx = Math.round((e.clientX - drag.startClientX) * scaleX);
    const dy = Math.round((e.clientY - drag.startClientY) * scaleY);
    canvas.style.transform = "";
    if (dx !== 0 || dy !== 0) {
      rasterSession.snapshot();
      rasterSession.image = shiftImage(rasterSession.image, dx, dy);
    }
    rasterDrag = null;
  } else {
    rasterDrag = null;
  }
  redrawRasterCanvas();
  renderRasterPanel();
}

function renderRasterRail(): void {
  const rail = $<HTMLDivElement>("raster-rail");
  rail.classList.remove("hidden");
  rail.innerHTML = "";
  for (const t of RASTER_TOOLS) {
    const btn = document.createElement("button");
    btn.className = `raster-tool-btn${rasterTool === t.id ? " active" : ""}`;
    btn.textContent = t.icon;
    btn.title = t.label;
    btn.addEventListener("click", () => {
      rasterTool = t.id;
      rasterDrag = null;
      renderRasterRail();
      renderRasterPanel();
      redrawRasterCanvas();
    });
    rail.appendChild(btn);
  }
}

function rasterSelectionActions(container: HTMLElement): void {
  if (!rasterSession) return;
  const s = section("Selection");
  const info = document.createElement("p");
  info.className = "raster-hint";
  info.textContent = rasterSelection
    ? "Selection active. Feather, delete, fill, or invert it below."
    : "No selection yet — draw one with Lasso or click with Magic Wand.";
  s.appendChild(info);

  if (rasterSelection) {
    s.appendChild(
      sliderControl(
        "Feather (px)",
        0,
        40,
        1,
        rasterOptions.lassoFeather,
        (v) => {
          rasterOptions.lassoFeather = v;
          if (rasterSelection) {
            setRasterSelection(featherMask(rasterSelection, v));
          }
        },
      ),
    );
    const row = document.createElement("div");
    row.className = "raster-toolbar";
    const invert = document.createElement("button");
    invert.className = "mini";
    invert.textContent = "Invert";
    invert.addEventListener("click", () => {
      if (rasterSelection) setRasterSelection(invertMask(rasterSelection));
    });
    const clear = document.createElement("button");
    clear.className = "mini";
    clear.textContent = "Clear";
    clear.addEventListener("click", () => setRasterSelection(null));
    const del = document.createElement("button");
    del.className = "mini";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      if (!rasterSession || !rasterSelection) return;
      rasterSession.snapshot();
      applyMaskDelete(rasterSession.image, rasterSelection);
      redrawRasterCanvas();
    });
    const fill = document.createElement("button");
    fill.className = "mini";
    fill.textContent = "Fill color";
    fill.addEventListener("click", () => {
      if (!rasterSession || !rasterSelection) return;
      rasterSession.snapshot();
      applyMaskFill(rasterSession.image, rasterSelection, {
        ...hexToRgbColor(rasterOptions.brushColor),
        a: 1,
      });
      redrawRasterCanvas();
    });
    row.append(invert, clear, del, fill);
    s.appendChild(row);
  }
  container.appendChild(s);
}

function renderRasterPanel(): void {
  if (!rasterSession) return;
  renderRasterRail();
  inspectorEl.innerHTML = "";

  const asset = rasterEditingClipId
    ? findAsset(locateClip(rasterEditingClipId)?.clip.assetId ?? "")
    : undefined;

  const toolbar = document.createElement("div");
  toolbar.className = "raster-toolbar";
  const title = document.createElement("div");
  title.className = "raster-title";
  title.textContent = asset ? `Editing ${assetName(asset)}` : "Editing photo";
  toolbar.appendChild(title);

  const undoBtn = document.createElement("button");
  undoBtn.className = "mini";
  undoBtn.textContent = "↶ Undo";
  undoBtn.disabled = !rasterSession.canUndo();
  undoBtn.addEventListener("click", () => {
    rasterSession?.undo();
    redrawRasterCanvas();
    renderRasterPanel();
  });
  const redoBtn = document.createElement("button");
  redoBtn.className = "mini";
  redoBtn.textContent = "↷ Redo";
  redoBtn.disabled = !rasterSession.canRedo();
  redoBtn.addEventListener("click", () => {
    rasterSession?.redo();
    redrawRasterCanvas();
    renderRasterPanel();
  });
  const discardBtn = document.createElement("button");
  discardBtn.className = "mini";
  discardBtn.textContent = "✕ Discard";
  discardBtn.addEventListener("click", () => exitRasterMode());
  const applyBtn = document.createElement("button");
  applyBtn.className = "tool primary";
  applyBtn.textContent = "✓ Apply";
  applyBtn.addEventListener("click", () => void applyRasterEdit());
  toolbar.append(undoBtn, redoBtn, discardBtn, applyBtn);
  inspectorEl.appendChild(toolbar);

  const body = document.createElement("div");
  inspectorEl.appendChild(body);

  switch (rasterTool) {
    case "move": {
      const p = document.createElement("p");
      p.className = "raster-hint";
      p.textContent = "Drag on the canvas to shift the photo's content. The vacated edge becomes transparent.";
      body.appendChild(p);
      break;
    }
    case "crop": {
      const s = section("Crop");
      const hint = document.createElement("p");
      hint.className = "raster-hint";
      hint.textContent = "Drag a rectangle on the canvas, then apply.";
      s.appendChild(hint);
      if (rasterDrag?.kind === "crop") {
        const row = document.createElement("div");
        row.className = "raster-toolbar";
        const apply = document.createElement("button");
        apply.className = "tool primary";
        apply.textContent = "Apply Crop";
        apply.addEventListener("click", () => {
          if (!rasterSession || rasterDrag?.kind !== "crop") return;
          const { rect } = rasterDrag;
          if (rect.width < 1 || rect.height < 1) return;
          rasterSession.snapshot();
          rasterSession.image = cropImage(rasterSession.image, rect);
          rasterSelection = null;
          rasterSelectionOverlay = null;
          rasterDrag = null;
          redrawRasterCanvas();
          renderRasterPanel();
        });
        const cancel = document.createElement("button");
        cancel.className = "mini";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => {
          rasterDrag = null;
          redrawRasterCanvas();
          renderRasterPanel();
        });
        row.append(apply, cancel);
        s.appendChild(row);
      }
      body.appendChild(s);
      break;
    }
    case "transform": {
      const s = section("Resize");
      const widthInput = document.createElement("input");
      widthInput.type = "number";
      widthInput.min = "1";
      widthInput.value = String(rasterSession.image.width);
      const heightInput = document.createElement("input");
      heightInput.type = "number";
      heightInput.min = "1";
      heightInput.value = String(rasterSession.image.height);
      for (const input of [widthInput, heightInput]) {
        input.className = "theme-name-input";
        input.style.marginBottom = "6px";
      }
      const resizeBtn = document.createElement("button");
      resizeBtn.className = "tool primary";
      resizeBtn.textContent = "Apply Resize";
      resizeBtn.addEventListener("click", () => {
        if (!rasterSession) return;
        const w = Math.max(1, Math.round(Number(widthInput.value)));
        const h = Math.max(1, Math.round(Number(heightInput.value)));
        rasterSession.snapshot();
        rasterSession.image = resizeImage(rasterSession.image, w, h);
        rasterSelection = null;
        rasterSelectionOverlay = null;
        redrawRasterCanvas();
        renderRasterPanel();
      });
      s.append(widthInput, heightInput, resizeBtn);
      body.appendChild(s);

      const rotSection = section("Rotate");
      const rotations = document.createElement("div");
      rotations.className = "raster-toolbar";
      for (const [label, deg] of [
        ["⟲ 90°", -90],
        ["⟳ 90°", 90],
        ["180°", 180],
      ] as const) {
        const btn = document.createElement("button");
        btn.className = "mini";
        btn.textContent = label;
        btn.addEventListener("click", () => {
          if (!rasterSession) return;
          rasterSession.snapshot();
          rasterSession.image = rotateImage(rasterSession.image, deg);
          rasterSelection = null;
          rasterSelectionOverlay = null;
          redrawRasterCanvas();
          renderRasterPanel();
        });
        rotations.appendChild(btn);
      }
      rotSection.appendChild(rotations);
      body.appendChild(rotSection);
      break;
    }
    case "brush": {
      const s = section("Brush");
      const colorRow = document.createElement("div");
      colorRow.className = "control";
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = rasterOptions.brushColor;
      colorInput.addEventListener("input", () => {
        rasterOptions.brushColor = colorInput.value;
      });
      colorRow.appendChild(colorInput);
      s.appendChild(colorRow);
      s.appendChild(
        sliderControl("Size (px)", 1, 200, 1, rasterOptions.brushSize, (v) => (rasterOptions.brushSize = v)),
      );
      s.appendChild(
        sliderControl("Opacity", 0, 1, 0.05, rasterOptions.brushOpacity, (v) => (rasterOptions.brushOpacity = v)),
      );
      s.appendChild(
        sliderControl("Hardness", 0, 1, 0.05, rasterOptions.brushHardness, (v) => (rasterOptions.brushHardness = v)),
      );
      body.appendChild(s);
      break;
    }
    case "eraser": {
      const s = section("Eraser");
      s.appendChild(
        sliderControl("Size (px)", 1, 200, 1, rasterOptions.eraserSize, (v) => (rasterOptions.eraserSize = v)),
      );
      s.appendChild(
        sliderControl("Opacity", 0, 1, 0.05, rasterOptions.eraserOpacity, (v) => (rasterOptions.eraserOpacity = v)),
      );
      s.appendChild(
        sliderControl("Hardness", 0, 1, 0.05, rasterOptions.eraserHardness, (v) => (rasterOptions.eraserHardness = v)),
      );
      body.appendChild(s);
      break;
    }
    case "clone": {
      const s = section("Clone Stamp");
      const hint = document.createElement("p");
      hint.className = "raster-hint";
      hint.textContent = cloneSource
        ? "Source set. Drag on the canvas to paint from it."
        : "Alt/Option-click on the canvas to set the clone source, then drag to paint.";
      s.appendChild(hint);
      s.appendChild(
        sliderControl("Size (px)", 1, 300, 1, rasterOptions.cloneSize, (v) => (rasterOptions.cloneSize = v)),
      );
      s.appendChild(
        sliderControl("Opacity", 0, 1, 0.05, rasterOptions.cloneOpacity, (v) => (rasterOptions.cloneOpacity = v)),
      );
      s.appendChild(
        sliderControl("Hardness", 0, 1, 0.05, rasterOptions.cloneHardness, (v) => (rasterOptions.cloneHardness = v)),
      );
      body.appendChild(s);
      break;
    }
    case "lasso": {
      const s = section("Lasso");
      const hint = document.createElement("p");
      hint.className = "raster-hint";
      hint.textContent = "Draw freehand on the canvas to select a region.";
      s.appendChild(hint);
      body.appendChild(s);
      rasterSelectionActions(body);
      break;
    }
    case "wand": {
      const s = section("Magic Wand");
      const hint = document.createElement("p");
      hint.className = "raster-hint";
      hint.textContent = "Click the canvas to select similar-colored pixels.";
      s.appendChild(hint);
      s.appendChild(
        sliderControl("Tolerance", 0, 1, 0.02, rasterOptions.wandTolerance, (v) => (rasterOptions.wandTolerance = v)),
      );
      const contiguousRow = document.createElement("label");
      contiguousRow.className = "control";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = rasterOptions.wandContiguous;
      cb.addEventListener("change", () => (rasterOptions.wandContiguous = cb.checked));
      contiguousRow.append(cb, document.createTextNode(" Contiguous (connected region only)"));
      s.appendChild(contiguousRow);
      body.appendChild(s);
      rasterSelectionActions(body);
      break;
    }
    case "sharpen": {
      const s = section("Sharpen");
      const hint = document.createElement("p");
      hint.className = "raster-hint";
      hint.textContent = "Unsharp mask over the whole photo.";
      s.appendChild(hint);
      s.appendChild(
        sliderControl("Amount", 0, 3, 0.1, rasterOptions.sharpenAmount, (v) => (rasterOptions.sharpenAmount = v)),
      );
      const apply = document.createElement("button");
      apply.className = "tool primary";
      apply.textContent = "Apply Sharpen";
      apply.addEventListener("click", () => {
        if (!rasterSession) return;
        rasterSession.snapshot();
        rasterSession.image = unsharpMask(rasterSession.image, rasterOptions.sharpenAmount);
        redrawRasterCanvas();
        renderRasterPanel();
      });
      s.appendChild(apply);
      body.appendChild(s);
      break;
    }
    case "smartfill": {
      const s = section("Smart Fill");
      const hint = document.createElement("p");
      hint.className = "raster-hint";
      hint.textContent =
        "Classical harmonic-diffusion fill — smoothly reconstructs the selected area from its surrounding pixels. Not AI/ML; no model, no network call. Select an area first with Lasso or Magic Wand.";
      s.appendChild(hint);
      s.appendChild(
        sliderControl(
          "Strength (iterations)",
          20,
          400,
          10,
          rasterOptions.smartFillIterations,
          (v) => (rasterOptions.smartFillIterations = v),
        ),
      );
      const apply = document.createElement("button");
      apply.className = "tool primary";
      apply.textContent = "Fill Selection";
      apply.disabled = !rasterSelection;
      apply.addEventListener("click", () => {
        if (!rasterSession || !rasterSelection) return;
        rasterSession.snapshot();
        rasterSession.image = diffusionFill(
          rasterSession.image,
          rasterSelection,
          rasterOptions.smartFillIterations,
        );
        redrawRasterCanvas();
        renderRasterPanel();
      });
      s.appendChild(apply);
      body.appendChild(s);
      break;
    }
    case "bgremove": {
      const s = section("Remove Background");
      const hint = document.createElement("p");
      hint.className = "raster-hint";
      hint.textContent =
        "Color-key removal — pixels near the key color become transparent. Deterministic; no ML model. " +
        "Works best against a plain, mostly solid-colored background. Busy/textured backgrounds or " +
        "subject colors close to the background will need a lower Tolerance and manual key color.";
      s.appendChild(hint);
      const autoRow = document.createElement("label");
      autoRow.className = "control";
      const autoCb = document.createElement("input");
      autoCb.type = "checkbox";
      autoCb.checked = rasterOptions.bgAuto;
      autoCb.addEventListener("change", () => {
        rasterOptions.bgAuto = autoCb.checked;
        colorField.style.display = autoCb.checked ? "none" : "";
      });
      autoRow.append(autoCb, document.createTextNode(" Auto-detect from corners"));
      s.appendChild(autoRow);
      const colorField = document.createElement("div");
      colorField.className = "control";
      colorField.style.display = rasterOptions.bgAuto ? "none" : "";
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = rasterOptions.bgKeyColor;
      colorInput.addEventListener("input", () => (rasterOptions.bgKeyColor = colorInput.value));
      colorField.appendChild(colorInput);
      s.appendChild(colorField);
      s.appendChild(
        sliderControl("Tolerance", 0, 1, 0.02, rasterOptions.bgThreshold, (v) => (rasterOptions.bgThreshold = v)),
      );
      s.appendChild(
        sliderControl("Softness", 0, 1, 0.02, rasterOptions.bgSoftness, (v) => (rasterOptions.bgSoftness = v)),
      );
      const apply = document.createElement("button");
      apply.className = "tool primary";
      apply.textContent = "Apply";
      apply.addEventListener("click", () => {
        if (!rasterSession) return;
        const key = rasterOptions.bgAuto
          ? cornerKeyColor(rasterSession.image)
          : hexToRgbColor(rasterOptions.bgKeyColor);
        rasterSession.snapshot();
        rasterSession.image = colorKeyAlpha(
          rasterSession.image,
          key,
          rasterOptions.bgThreshold,
          rasterOptions.bgSoftness,
        );
        redrawRasterCanvas();
        renderRasterPanel();
      });
      s.appendChild(apply);
      body.appendChild(s);
      break;
    }
    default:
      break;
  }
}

async function applyRasterEdit(): Promise<void> {
  if (!rasterSession || !rasterEditingClipId) return;
  const loc = locateClip(rasterEditingClipId);
  const sourceAsset = loc ? findAsset(loc.clip.assetId) : undefined;
  try {
    const blob = await rasterSession.toBlob();
    const checksum = await sha256Hex(await blob.arrayBuffer());
    const url = URL.createObjectURL(blob);
    const assetId = `asset-${crypto.randomUUID().slice(0, 8)}`;
    const registered = commit(
      buildRegisterAsset(nextCtx(), {
        asset: {
          id: assetId,
          projectId: PROJECT_ID,
          kind: "image",
          originalUri: url,
          checksum,
          metadata: {
            fileSizeBytes: String(blob.size),
            durationUs: sourceAsset?.metadata.durationUs ?? "5000000",
            width: rasterSession.image.width,
            height: rasterSession.image.height,
          },
          createdAt: new Date().toISOString(),
        },
      }),
    );
    if (!registered) return;
    const img = new Image();
    img.src = url;
    await new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
    });
    mediaCache.set(url, img);
    toast("Applied. Your edit is now a new photo in the Media bin — drag it onto the timeline.");
    exitRasterMode();
  } catch (err) {
    toast(err instanceof Error ? err.message : "Failed to apply the edit.", true);
  }
}

// ==========================================================================
// Events
// ==========================================================================
function bindEvents(): void {
  $("mode-video").addEventListener("click", () => setMode("video"));
  $("mode-photo").addEventListener("click", () => setMode("photo"));

  $("theme-dark").addEventListener("click", () => applyTheme("dark"));
  $("theme-light").addEventListener("click", () => applyTheme("light"));
  $("theme-system").addEventListener("click", () => applyTheme("system"));
  bindThemePicker();

  $("btn-import").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) void importFile(file);
    fileInput.value = "";
  });

  $("btn-undo").addEventListener("click", () => {
    if (session.undo()) updateUI();
  });
  $("btn-redo").addEventListener("click", () => {
    if (session.redo()) updateUI();
  });

  $("btn-play").addEventListener("click", () => {
    playback = playback.playing ? pause(playback) : play(playback);
    syncTransport();
  });
  $("btn-start").addEventListener("click", () => {
    playback = seek(playback, "0");
    syncTransport();
    drawPreview();
    renderTimeline();
  });
  $("btn-prev").addEventListener("click", () => stepFrame(-1));
  $("btn-next").addEventListener("click", () => stepFrame(1));

  seekEl.addEventListener("input", () => {
    const dur = Number(playback.durationUs);
    playback = seek(
      playback,
      String(Math.round((Number(seekEl.value) / 1000) * dur)),
    );
    syncTransport();
    drawPreview();
    renderTimeline();
  });

  $("zoom").addEventListener("input", (e) => {
    zoom = Number((e.target as HTMLInputElement).value);
    renderTimeline();
  });

  $("btn-add-track").addEventListener("click", () => {
    const seq = activeSequence();
    if (!seq) return;
    const index = seq.tracks.length;
    commit(
      buildAddTrack(nextCtx(), {
        sequenceId: SEQUENCE_ID,
        track: {
          id: `track-${crypto.randomUUID().slice(0, 8)}`,
          kind: "video",
          name: `Video ${index}`,
          index,
        },
      }),
    );
  });

  $("btn-delete").addEventListener("click", () => {
    if (!selectedClipId) return;
    const id = selectedClipId;
    selectedClipId = null;
    commit(buildDeleteClip(nextCtx(), { sequenceId: SEQUENCE_ID, clipId: id }));
  });

  $("btn-split").addEventListener("click", splitSelectedClip);
  $("btn-export").addEventListener("click", doExport);

  window.addEventListener("keydown", (e) => {
    if (e.target !== document.body) return;
    if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) {
        if (session.redo()) updateUI();
      } else if (session.undo()) {
        updateUI();
      }
    } else if (
      (e.code === "Delete" || e.code === "Backspace") &&
      selectedClipId
    ) {
      commit(
        buildDeleteClip(nextCtx(), {
          sequenceId: SEQUENCE_ID,
          clipId: selectedClipId,
        }),
      );
      selectedClipId = null;
    } else if (e.code === "Space") {
      e.preventDefault();
      playback = playback.playing ? pause(playback) : play(playback);
      syncTransport();
    }
  });

  window.addEventListener("resize", drawPreview);

  // External file drag & drop anywhere in the window.
  const overlay = $<HTMLDivElement>("drop-overlay");
  const hasFiles = (e: DragEvent): boolean =>
    e.dataTransfer?.types.includes("Files") ?? false;
  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth += 1;
    overlay.classList.remove("hidden");
  });
  window.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) overlay.classList.add("hidden");
  });
  window.addEventListener("drop", (e) => {
    dragDepth = 0;
    overlay.classList.add("hidden");
    if (e.dataTransfer?.files.length) {
      e.preventDefault();
      void importFiles(e.dataTransfer.files);
    }
  });
}

function splitSelectedClip(): void {
  const loc = locateClip(selectedClipId);
  if (!loc) return;
  const { clip, track } = loc;
  const start = BigInt(clip.timelineStartUs);
  const end = start + BigInt(clip.timelineDurationUs);
  const playhead = BigInt(playback.currentTimeUs);
  if (playhead <= start || playhead >= end) {
    toast("Move the playhead over the selected clip to split.", true);
    return;
  }
  const offset = playhead - start; // source offset (rate 1/1)
  const splitSource = BigInt(clip.sourceInUs) + offset;

  // Trim the original to end at the playhead...
  if (
    !commit(
      buildTrimClip(nextCtx(), {
        sequenceId: SEQUENCE_ID,
        clipId: clip.id,
        sourceInUs: clip.sourceInUs,
        sourceOutUs: splitSource.toString(),
      }),
    )
  ) {
    return;
  }
  // ...and add a new clip for the remainder.
  commit(
    buildAddClip(nextCtx(), {
      sequenceId: SEQUENCE_ID,
      trackId: track.id,
      clip: {
        id: `clip-${crypto.randomUUID().slice(0, 8)}`,
        assetId: clip.assetId,
        timelineStartUs: playhead.toString(),
        sourceInUs: splitSource.toString(),
        sourceOutUs: clip.sourceOutUs,
        playbackRate: { numerator: 1, denominator: 1 },
      },
    }),
  );
}

function doExport(): void {
  const project = session.getProject();
  if (!project) return;
  const result = planExport(project, SEQUENCE_ID, {
    width: 1920,
    height: 1080,
    frameRate: FRAME_RATE,
    videoCodec: "h264",
    container: "mp4",
    videoBitrateKbps: 8000,
    audioCodec: "aac",
    audioSampleRate: 48000,
  });
  if (!result.ok) {
    toast(`Export: ${result.error.message}`, true);
    return;
  }
  const { framesTotal, durationUs, audioSampleCount } = result.plan;
  toast(
    `Export plan: ${framesTotal} frames, ${formatTime(durationUs)}, ${audioSampleCount} audio samples (H.264/MP4).`,
  );
}

// ==========================================================================
// Bootstrap
// ==========================================================================
seed();
bindEvents();
initTheme();
setMode("photo");
updateUI();
requestAnimationFrame(animate);
