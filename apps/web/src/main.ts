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
      range("threshold", "Tolerance", 0, 1, 0.02, 0.28),
      range("softness", "Softness", 0, 1, 0.02, 0.12),
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

function addAssetToTimeline(
  assetId: string,
  kind: MediaAsset["kind"],
  durationUs: string,
): void {
  const seq = activeSequence();
  if (!seq) return;
  const trackId = kind === "audio" ? AUDIO_TRACK : VIDEO_TRACK;
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
  if (added) {
    selectedClipId = clipId;
    updateUI();
  }
}

// ==========================================================================
// Preview rendering
// ==========================================================================
function drawPreview(): void {
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

  const scale = Math.min(cw / mw, ch / mh);
  const dw = mw * scale;
  const dh = mh * scale;
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
  cctx.drawImage(drawable, -dw / 2, -dh / 2, dw, dh);
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
  const threshold = getParamNumber(fx, "threshold", 0.28) * MAX;
  const softness = getParamNumber(fx, "softness", 0.12) * MAX;

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
  selectedClipId = clip.id;
  updateUI();
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
  commit(
    buildAddEffect(nextCtx(), {
      sequenceId: SEQUENCE_ID,
      clipId: selectedClipId,
      effect,
    }),
  );
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
    const kind = document.createElement("span");
    kind.className = "media-kind";
    kind.textContent =
      asset.kind === "audio" ? "🔊" : asset.kind === "video" ? "🎞" : "🖼";
    const name = document.createElement("span");
    name.className = "media-name";
    name.textContent = assetName(asset);
    const add = document.createElement("span");
    add.className = "media-add";
    add.textContent = "+ timeline";
    el.append(kind, name, add);
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
// Events
// ==========================================================================
function bindEvents(): void {
  $("mode-video").addEventListener("click", () => setMode("video"));
  $("mode-photo").addEventListener("click", () => setMode("photo"));

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
    commit(
      buildDeleteClip(nextCtx(), {
        sequenceId: SEQUENCE_ID,
        clipId: selectedClipId,
      }),
    );
    selectedClipId = null;
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
setMode("photo");
updateUI();
requestAnimationFrame(animate);
