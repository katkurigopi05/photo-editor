import {
  createEditorState,
  executeCommand,
  undo,
  redo,
} from "@director/editor-state";
import {
  timeToFrameIndex,
  frameToStartTimeUs,
  createPlaybackState,
  play,
  pause,
  seek,
  setRate,
  setLoopRegion,
  tick,
  resolveAtTime,
  sequenceDurationUs,
  planPrefetch,
} from "@director/playback-controller";
import type {
  Sequence,
  TimelineClip,
  Track,
  EffectInstance,
  EffectType,
  MediaAsset,
} from "@director/project-schema";
import type { ProjectCommand } from "@director/command-schema";

type PhotoCropAspect = "none" | "1:1" | "4:5" | "16:9";
type AssetMetadata = MediaAsset["metadata"];

// ==========================================================================
// APPLICATION STATE
// ==========================================================================
let editorState = createEditorState();
const activeProjectId = "project-1";
const activeSequenceId = "sequence-1";
let selectedClipId: string | null = null;
let zoomLevel = 120; // pixels per second
let isReplaying = false;
let currentAppMode: "video" | "photo" = "video";
let photoCropAspect: PhotoCropAspect = "none";
let cinematicLetterbox = false;
const mediaCache = new Map<
  string,
  HTMLImageElement | HTMLVideoElement | HTMLAudioElement
>();

// Playback transport state
let playbackState = createPlaybackState("0");
let isDraggingPlayhead = false;
let isLoopEnabled = false;

// Dragging state for clips
interface ClipDragState {
  clipId: string;
  originalTrackId: string;
  originalStartUs: string;
  originalSourceInUs: string;
  originalSourceOutUs: string;
  originalDurationUs: string;
  dragType: "move" | "trim-left" | "trim-right";
  startX: number;
}
let activeDrag: ClipDragState | null = null;

// Mock database of assets available for import
const MOCK_ASSET_TEMPLATES = [
  {
    name: "sunset_beach.mp4",
    kind: "video" as const,
    duration: 15,
    width: 1920,
    height: 1080,
  },
  {
    name: "forest_ambience.wav",
    kind: "audio" as const,
    duration: 25,
    width: undefined,
    height: undefined,
  },
  {
    name: "tokyo_timelapse.mp4",
    kind: "video" as const,
    duration: 10,
    width: 3840,
    height: 2160,
  },
  {
    name: "mountain_peak.png",
    kind: "image" as const,
    duration: 8,
    width: 1920,
    height: 1080,
  },
  {
    name: "dialogue_scene.mp4",
    kind: "video" as const,
    duration: 20,
    width: 1280,
    height: 720,
  },
];

// Helper to convert microseconds to string seconds
const usToSec = (us: string): number => Number(us) / 1_000_000;
// Helper to convert seconds to microsecond string
const secToUsStr = (sec: number): string =>
  Math.round(sec * 1_000_000).toString();

// Helper to extract asset filename from originalUri
function getAssetName(asset: MediaAsset | undefined): string {
  if (!asset) return "Clip";
  const parts = asset.originalUri.split("/");
  return parts[parts.length - 1] || "asset";
}

// ==========================================================================
// COMMAND DISPATCH & ATOMICAL ENGINE HOOKS
// ==========================================================================
function dispatch(commandType: string, payload: unknown): boolean {
  if (isReplaying) return false;
  const baseVersion = editorState.project
    ? editorState.project.currentVersion
    : 0;

  // executeCommand validates untrusted input at the public boundary, so the
  // envelope is passed as-is (no unchecked cast into ProjectCommand here).
  const cmd = {
    id: crypto.randomUUID(),
    commandType,
    baseVersion,
    actor: { type: "user" as const, id: "user-1" },
    createdAt: new Date().toISOString(),
    payload,
  };

  const result = executeCommand(editorState, cmd);
  if (result.ok) {
    editorState = result.state;

    // Sync sequence duration with playback state
    const seq = getActiveSequence();
    if (seq) {
      const dur = sequenceDurationUs(seq);
      playbackState.durationUs = dur;
      // Clamp current time if sequence shrank
      if (BigInt(playbackState.currentTimeUs) > BigInt(dur)) {
        playbackState = seek(playbackState, dur);
      }
    }

    updateUI();
    return true;
  } else {
    console.error("Command execution failed", result.error);
    alert(`Command rejected [${result.error.code}]: ${result.error.message}`);
    return false;
  }
}

function handleUndo() {
  const result = undo(editorState);
  if (result.ok) {
    editorState = result.state;
    const seq = getActiveSequence();
    if (seq) {
      playbackState.durationUs = sequenceDurationUs(seq);
    }
    updateUI();
  } else {
    console.warn("Undo failed:", result.error);
  }
}

function handleRedo() {
  const result = redo(editorState);
  if (result.ok) {
    editorState = result.state;
    const seq = getActiveSequence();
    if (seq) {
      playbackState.durationUs = sequenceDurationUs(seq);
    }
    updateUI();
  } else {
    console.warn("Redo failed:", result.error);
  }
}

// Replays the entire command log step-by-step for the user
async function runStepByStepReplay() {
  if (isReplaying) return;
  const log = [...editorState.operationLog];
  if (log.length === 0) {
    alert("No commands in the operation log to replay.");
    return;
  }

  isReplaying = true;
  selectedClipId = null;
  playbackState = pause(playbackState);

  // Clear the state
  editorState = createEditorState();
  updateUI();

  // Replay each command sequentially with a small delay
  for (let i = 0; i < log.length; i++) {
    const originalCmd = log[i]!;
    const baseVersion = editorState.project
      ? editorState.project.currentVersion
      : 0;
    const cmd: ProjectCommand = {
      ...originalCmd.command,
      baseVersion,
    };

    await new Promise((resolve) => setTimeout(resolve, 500));

    const result = executeCommand(editorState, cmd);
    if (result.ok) {
      editorState = result.state;
      const seq = getActiveSequence();
      if (seq) {
        playbackState.durationUs = sequenceDurationUs(seq);
      }
      updateUI();
    } else {
      console.error("Replay step failed", result.error);
      break;
    }
  }

  isReplaying = false;
  alert("Replay completed successfully!");
}

// ==========================================================================
// DOM SELECTORS
// ==========================================================================
const btnUndo = document.getElementById("btn-undo") as HTMLButtonElement;
const btnRedo = document.getElementById("btn-redo") as HTMLButtonElement;
const btnReplayLog = document.getElementById(
  "btn-replay-log",
) as HTMLButtonElement;
const projectTitle = document.getElementById(
  "project-title-display",
) as HTMLElement;
const mediaList = document.getElementById("media-list") as HTMLElement;
const historyList = document.getElementById("history-list") as HTMLElement;
const historyVersion = document.getElementById(
  "history-version-counter",
) as HTMLElement;
const previewCanvas = document.getElementById(
  "preview-canvas",
) as HTMLCanvasElement;
const activeClipsOverlay = document.getElementById(
  "active-clips-overlay",
) as HTMLElement;
const currentTimeDisplay = document.getElementById(
  "current-time-display",
) as HTMLElement;
const durationDisplay = document.getElementById(
  "duration-display",
) as HTMLElement;
const globalTimecode = document.getElementById(
  "global-timecode",
) as HTMLElement;
const globalFrameDisplay = document.getElementById(
  "global-frame-display",
) as HTMLElement;
const btnPrevFrame = document.getElementById(
  "btn-prev-frame",
) as HTMLButtonElement;
const btnTogglePlay = document.getElementById(
  "btn-toggle-play",
) as HTMLButtonElement;
const playIcon = document.getElementById("play-icon") as HTMLElement;
const pauseIcon = document.getElementById("pause-icon") as HTMLElement;
const btnNextFrame = document.getElementById(
  "btn-next-frame",
) as HTMLButtonElement;
const btnToggleLoop = document.getElementById(
  "btn-toggle-loop",
) as HTMLButtonElement;
const selectPlaybackRate = document.getElementById(
  "select-playback-rate",
) as HTMLSelectElement;
const prefetchItems = document.getElementById("prefetch-items") as HTMLElement;
const inspectorContent = document.getElementById(
  "inspector-content",
) as HTMLElement;
const btnAddTrack = document.getElementById(
  "btn-add-track",
) as HTMLButtonElement;
const btnSplitClip = document.getElementById(
  "btn-split-clip",
) as HTMLButtonElement;
const btnDeleteClip = document.getElementById(
  "btn-delete-clip",
) as HTMLButtonElement;
const loopInputs = document.getElementById("loop-inputs") as HTMLElement;
const loopStartInput = document.getElementById(
  "loop-start-input",
) as HTMLInputElement;
const loopEndInput = document.getElementById(
  "loop-end-input",
) as HTMLInputElement;
const btnApplyLoop = document.getElementById(
  "btn-apply-loop",
) as HTMLButtonElement;
const btnClearLoop = document.getElementById(
  "btn-clear-loop",
) as HTMLButtonElement;
const timelineZoomSlider = document.getElementById(
  "timeline-zoom-slider",
) as HTMLInputElement;
const trackHeadersColumn = document.getElementById(
  "track-headers-column",
) as HTMLElement;
const tracksLanesContainer = document.getElementById(
  "tracks-lanes-container",
) as HTMLElement;
const timelineRuler = document.getElementById("timeline-ruler") as HTMLElement;
const rulerCanvas = document.getElementById(
  "ruler-canvas",
) as HTMLCanvasElement;
const timelinePlayhead = document.getElementById(
  "timeline-playhead",
) as HTMLElement;
const timelineGridScroller = document.getElementById(
  "timeline-grid-scroller",
) as HTMLElement;
const btnImportMedia = document.getElementById(
  "btn-import-media",
) as HTMLButtonElement;
const importModal = document.getElementById("import-modal") as HTMLElement;
const btnModalClose = document.getElementById(
  "btn-modal-close",
) as HTMLButtonElement;
const btnModalCancel = document.getElementById(
  "btn-modal-cancel",
) as HTMLButtonElement;
const importForm = document.getElementById("import-form") as HTMLFormElement;

// ==========================================================================
// PURE DATA RESOLVERS
// ==========================================================================
function getActiveSequence(): Sequence | undefined {
  return editorState.project?.sequences.find((s) => s.id === activeSequenceId);
}

function getSelectedClip(): { clip: TimelineClip; track: Track } | null {
  if (!selectedClipId) return null;
  const seq = getActiveSequence();
  if (!seq) return null;
  for (const track of seq.tracks) {
    const clip = track.clips.find((c) => c.id === selectedClipId);
    if (clip) return { clip, track };
  }
  return null;
}

// Format microseconds as timecode HH:MM:SS:FF (assuming 30fps)
function formatTimecode(us: string, fps = 30): string {
  const totalSeconds = Number(us) / 1_000_000;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const f = Math.floor((totalSeconds % 1) * fps);

  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

// ==========================================================================
// RENDER & VIEWER LOOP (PREVIEW PAINTING)
// ==========================================================================
const ctx = previewCanvas.getContext("2d")!;

function drawPreview() {
  // Clear canvas
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

  const seq = getActiveSequence();
  if (!seq) return;

  const currentUs = playbackState.currentTimeUs;
  const activeClips = resolveAtTime(seq, currentUs);

  if (activeClips.length === 0) {
    activeClipsOverlay.textContent = "Active: None";
    activeClipsOverlay.className = "clips-badge";

    // Draw simple calibration grid/pattern when empty
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x < previewCanvas.width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, previewCanvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < previewCanvas.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(previewCanvas.width, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.font = "Outfit 18px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      "No Active Clip (Gap)",
      previewCanvas.width / 2,
      previewCanvas.height / 2,
    );
    return;
  }

  // Update badge overlay
  const clipNames = activeClips.map((c) => {
    const asset = editorState.project?.assets.find((a) => a.id === c.assetId);
    return getAssetName(asset);
  });
  activeClipsOverlay.textContent = `Active: ${clipNames.join(", ")}`;
  activeClipsOverlay.className = "clips-badge active";

  // Draw active layers (video tracks stacked on top)
  const renderStack = [...activeClips].reverse();

  for (const active of renderStack) {
    const asset = editorState.project?.assets.find(
      (a) => a.id === active.assetId,
    );
    if (!asset) continue;

    const trackObj = getActiveSequence()?.tracks.find(
      (t) => t.id === active.trackId,
    );
    const clipObj = trackObj?.clips.find((c) => c.id === active.clipId);
    if (!clipObj) continue;

    ctx.save();

    // 1. BUILD CSS FILTER STACK FROM EFFECTS
    let filterString = "";
    let opacityValue = 1;
    let rotateAngle = 0;
    let flipH = false;
    let flipV = false;
    let vignetteStrength = 0;
    let tintColor = "";
    let tintAmount = 0;
    let portraitBlurRad = 0;
    let portraitBokeh = 0;
    let portraitSubjectScale = 1.0;
    let duotoneShadows = "";
    let duotoneHighlights = "";
    let retroNoiseAmt = 0;
    let retroScanlinesSpacing = 0;
    let borderWidth = 0;
    let borderColor = "";

    for (const effect of clipObj.effects) {
      if (!effect.enabled) continue;

      // Ignore effects that do not belong to the current active workspace mode
      if (currentAppMode === "photo") {
        const supported = [
          "color.brightness",
          "color.contrast",
          "color.grayscale",
          "color.sepia",
          "color.vignette",
          "color.tint",
          "color.exposure",
          "photo.portrait_blur",
          "color.duotone",
          "fx.border",
          "transform.rotate",
          "transform.flip",
        ];
        if (!supported.includes(effect.type)) continue;
      } else {
        const supported = [
          "color.brightness",
          "color.contrast",
          "transform.opacity",
          "blur.gaussian",
          "color.hue_rotate",
          "color.saturate",
          "color.invert",
          "fx.retro_noise",
          "transform.rotate",
          "transform.flip",
        ];
        if (!supported.includes(effect.type)) continue;
      }

      if (effect.type === "color.brightness") {
        const amt = effect.params.amount; // [-1, 1] -> [0, 200%]
        const pct = Math.round((amt + 1) * 100);
        filterString += ` brightness(${pct}%)`;
      } else if (effect.type === "color.contrast") {
        const amt = effect.params.amount; // [0, 4] -> [0%, 400%]
        const pct = Math.round(amt * 100);
        filterString += ` contrast(${pct}%)`;
      } else if (effect.type === "blur.gaussian") {
        const rad = effect.params.radiusPx;
        filterString += ` blur(${rad}px)`;
      } else if (effect.type === "transform.opacity") {
        opacityValue = effect.params.opacity;
      } else if (effect.type === "color.grayscale") {
        const amt = effect.params.amount;
        filterString += ` grayscale(${Math.round(amt * 100)}%)`;
      } else if (effect.type === "color.sepia") {
        const amt = effect.params.amount;
        filterString += ` sepia(${Math.round(amt * 100)}%)`;
      } else if (effect.type === "transform.rotate") {
        rotateAngle = effect.params.angleDegrees;
      } else if (effect.type === "transform.flip") {
        flipH = effect.params.horizontal;
        flipV = effect.params.vertical;
      } else if (effect.type === "color.hue_rotate") {
        const angle = effect.params.angleDegrees;
        filterString += ` hue-rotate(${angle}deg)`;
      } else if (effect.type === "color.saturate") {
        const amt = effect.params.amount;
        filterString += ` saturate(${Math.round(amt * 100)}%)`;
      } else if (effect.type === "color.invert") {
        const amt = effect.params.amount;
        filterString += ` invert(${Math.round(amt * 100)}%)`;
      } else if (effect.type === "color.exposure") {
        const amt = effect.params.amount;
        const multiplier = Math.pow(2, amt);
        filterString += ` brightness(${Math.round(multiplier * 100)}%)`;
      } else if (effect.type === "color.vignette") {
        vignetteStrength = effect.params.amount;
      } else if (effect.type === "color.tint") {
        tintColor = effect.params.colorHex;
        tintAmount = effect.params.amount;
      } else if (effect.type === "photo.portrait_blur") {
        portraitBlurRad = effect.params.blurRadiusPx;
        portraitBokeh = effect.params.bokehStrength;
        portraitSubjectScale = effect.params.subjectScale;
      } else if (effect.type === "color.duotone") {
        duotoneShadows = effect.params.shadowsHex;
        duotoneHighlights = effect.params.highlightsHex;
      } else if (effect.type === "fx.retro_noise") {
        retroNoiseAmt = effect.params.noiseAmount;
        retroScanlinesSpacing = effect.params.scanlineSpacing;
      } else if (effect.type === "fx.border") {
        borderWidth = effect.params.borderWidthPx;
        borderColor = effect.params.borderColorHex;
      }
    }

    if (filterString.trim()) {
      ctx.filter = filterString.trim();
    }
    ctx.globalAlpha = opacityValue;

    const width = previewCanvas.width;
    const height = previewCanvas.height;

    // Apply Geometric Transformations (Rotate & Flip)
    if (rotateAngle !== 0 || flipH || flipV) {
      ctx.translate(width / 2, height / 2);
      if (rotateAngle !== 0) {
        ctx.rotate((rotateAngle * Math.PI) / 180);
      }
      if (flipH || flipV) {
        ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      }
      ctx.translate(-width / 2, -height / 2);
    }

    // 2. DRAW BACKGROUND LAYER (Applying portrait background blur and bokeh if active)
    ctx.save();
    if (portraitBlurRad > 0) {
      const baseFilter = filterString.trim() ? filterString.trim() : "none";
      ctx.filter = `${baseFilter} blur(${portraitBlurRad}px)`;
    }

    let hue = 0;
    for (let charIdx = 0; charIdx < asset.id.length; charIdx++) {
      hue = (hue + asset.id.charCodeAt(charIdx) * 23) % 360;
    }

    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, `hsl(${hue}, 80%, 40%)`);
    grad.addColorStop(1, `hsl(${(hue + 60) % 360}, 90%, 15%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Draw Portrait Bokeh Circles (simulating photographic bokeh light spots in blurred background)
    if (portraitBlurRad > 0 && portraitBokeh > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${portraitBokeh * 0.25})`;
      const bokehPoints = [
        { x: width * 0.2, y: height * 0.3, r: 60 },
        { x: width * 0.8, y: height * 0.2, r: 80 },
        { x: width * 0.15, y: height * 0.7, r: 50 },
        { x: width * 0.75, y: height * 0.75, r: 70 },
        { x: width * 0.5, y: height * 0.25, r: 40 },
      ];
      for (const pt of bokehPoints) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore(); // Background is drawn. Restore filter state (so foreground is drawn without background blur!)

    // Apply Duotone Color Map onto background pixels
    if (duotoneShadows && duotoneHighlights) {
      ctx.save();
      ctx.globalCompositeOperation = "source-atop";
      const duoGrad = ctx.createLinearGradient(0, 0, width, height);
      duoGrad.addColorStop(0, duotoneShadows);
      duoGrad.addColorStop(1, duotoneHighlights);
      ctx.fillStyle = duoGrad;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    // 3. DRAW FOREGROUND SUBJECT LAYER (Subject gets scaled if portrait subjectScale is set)
    ctx.save();
    if (portraitSubjectScale !== 1.0) {
      ctx.translate(width / 2, height / 2);
      ctx.scale(portraitSubjectScale, portraitSubjectScale);
      ctx.translate(-width / 2, -height / 2);
    }

    if (asset.kind === "video") {
      let videoDrawn = false;
      if (asset.originalUri.startsWith("blob:")) {
        let vid = mediaCache.get(asset.originalUri) as
          HTMLVideoElement | undefined;
        if (!vid) {
          vid = document.createElement("video");
          vid.src = asset.originalUri;
          vid.muted = true;
          vid.playsInline = true;
          vid.loop = true;
          vid.load();
          mediaCache.set(asset.originalUri, vid);
        }
        if (vid.readyState >= 2) {
          const relativeTime =
            usToSec(currentUs) -
            usToSec(clipObj.timelineStartUs) +
            usToSec(clipObj.sourceInUs);
          // Sync video currentTime to the playhead
          if (Math.abs(vid.currentTime - relativeTime) > 0.15) {
            vid.currentTime = relativeTime;
          }
          ctx.drawImage(vid, 0, 0, width, height);
          videoDrawn = true;
        }
      }

      if (!videoDrawn) {
        // Fallback placeholder
        const t = usToSec(currentUs);
        const cx = width / 2 + Math.cos(t * 1.5) * 180;
        const cy = height / 2 + Math.sin(t * 2.2) * 90;
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.beginPath();
        ctx.arc(cx, cy, 70, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw scan lines for video look
      ctx.strokeStyle = "rgba(0, 0, 0, 0.1)";
      ctx.lineWidth = 1;
      for (let y = 0; y < height; y += 4) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    } else if (asset.kind === "image") {
      let imageDrawn = false;
      if (asset.originalUri.startsWith("blob:")) {
        let img = mediaCache.get(asset.originalUri) as
          HTMLImageElement | undefined;
        if (!img) {
          img = new Image();
          img.src = asset.originalUri;
          mediaCache.set(asset.originalUri, img);
        }
        if (img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, 0, 0, width, height);
          imageDrawn = true;
        }
      }

      if (!imageDrawn) {
        // Fallback placeholder
        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
        ctx.lineWidth = 4;
        ctx.strokeRect(40, 40, width - 80, height - 80);

        ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
        ctx.beginPath();
        ctx.arc(width / 2, height / 2 - 40, 45, 0, Math.PI * 2);
        ctx.moveTo(width / 2 - 90, height / 2 + 100);
        ctx.quadraticCurveTo(
          width / 2 - 90,
          height / 2 + 30,
          width / 2 - 50,
          height / 2 + 25,
        );
        ctx.lineTo(width / 2 + 50, height / 2 + 25);
        ctx.quadraticCurveTo(
          width / 2 + 90,
          height / 2 + 30,
          width / 2 + 90,
          height / 2 + 100,
        );
        ctx.closePath();
        ctx.fill();
      }
    } else if (asset.kind === "audio") {
      const t = usToSec(currentUs);
      const barCount = 40;
      const barGap = 4;
      const totalGapWidth = barGap * (barCount - 1);
      const barWidth = (width - totalGapWidth - 80) / barCount;
      const startX = 40;
      const maxBarHeight = height * 0.6;

      ctx.save();
      for (let i = 0; i < barCount; i++) {
        const phase = i * 0.15 + t * 12;
        const amplitude =
          0.3 + 0.7 * Math.abs(Math.sin(phase) * Math.cos(phase * 0.7));
        const currentBarHeight = maxBarHeight * amplitude;

        const bx = startX + i * (barWidth + barGap);
        const by = (height - currentBarHeight) / 2;

        const barGrad = ctx.createLinearGradient(
          0,
          by,
          0,
          by + currentBarHeight,
        );
        barGrad.addColorStop(0, "#ff5e62"); // red peak
        barGrad.addColorStop(0.3, "#ff9966"); // yellow-orange mid
        barGrad.addColorStop(1, "#38ef7d"); // green base

        ctx.fillStyle = barGrad;
        ctx.fillRect(bx, by, barWidth, currentBarHeight);
      }
      ctx.restore();
    }
    ctx.restore(); // Restore portrait subject zoom scale transforms

    // Draw Tint Overlay
    if (tintAmount > 0 && tintColor) {
      ctx.save();
      ctx.fillStyle = tintColor;
      ctx.globalAlpha = tintAmount;
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    // Draw Vignette Overlay
    if (vignetteStrength > 0) {
      ctx.save();
      const radius = Math.sqrt(
        Math.pow(width / 2, 2) + Math.pow(height / 2, 2),
      );
      const gradVig = ctx.createRadialGradient(
        width / 2,
        height / 2,
        radius * 0.4,
        width / 2,
        height / 2,
        radius,
      );
      gradVig.addColorStop(0, "rgba(0, 0, 0, 0)");
      gradVig.addColorStop(1, `rgba(0, 0, 0, ${vignetteStrength})`);
      ctx.fillStyle = gradVig;
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    // Draw Retro Scanlines & Noise Overlay
    if (retroNoiseAmt > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "source-atop";

      // Draw scanlines
      ctx.strokeStyle = `rgba(255, 255, 255, ${retroNoiseAmt * 0.15})`;
      ctx.lineWidth = 1;
      const spacing = retroScanlinesSpacing || 6;
      for (let y = 0; y < height; y += spacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw grains / noise particles
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      for (let i = 0; i < retroNoiseAmt * 800; i++) {
        const nx = Math.random() * width;
        const ny = Math.random() * height;
        const nsize = Math.random() * 1.5 + 1;
        ctx.fillRect(nx, ny, nsize, nsize);
      }
      ctx.restore();
    }

    // Draw Frame Border
    if (borderWidth > 0 && borderColor) {
      ctx.save();
      ctx.globalCompositeOperation = "source-atop";
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = borderWidth;
      ctx.strokeRect(
        borderWidth / 2,
        borderWidth / 2,
        width - borderWidth,
        height - borderWidth,
      );
      ctx.restore();
    }

    // Draw Crop Aspect guides for Photo Editor Mode
    if (currentAppMode === "photo" && photoCropAspect !== "none") {
      ctx.save();
      let boxWidth = width * 0.8;
      let boxHeight = height * 0.8;
      if (photoCropAspect === "1:1") {
        const size = Math.min(width, height) * 0.8;
        boxWidth = size;
        boxHeight = size;
      } else if (photoCropAspect === "4:5") {
        boxHeight = height * 0.8;
        boxWidth = boxHeight * (4 / 5);
        if (boxWidth > width * 0.8) {
          boxWidth = width * 0.8;
          boxHeight = boxWidth * (5 / 4);
        }
      } else if (photoCropAspect === "16:9") {
        boxWidth = width * 0.8;
        boxHeight = boxWidth * (9 / 16);
        if (boxHeight > height * 0.8) {
          boxHeight = height * 0.8;
          boxWidth = boxHeight * (16 / 9);
        }
      }
      const bx = (width - boxWidth) / 2;
      const by = (height - boxHeight) / 2;

      // Draw dimmed overlay outside crop box
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(0, 0, width, by);
      ctx.fillRect(0, by + boxHeight, width, height - (by + boxHeight));
      ctx.fillRect(0, by, bx, boxHeight);
      ctx.fillRect(bx + boxWidth, by, width - (bx + boxWidth), boxHeight);

      // Draw dashed border
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(bx, by, boxWidth, boxHeight);

      // Draw Rule of Thirds grids
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      // Verts
      ctx.moveTo(bx + boxWidth / 3, by);
      ctx.lineTo(bx + boxWidth / 3, by + boxHeight);
      ctx.moveTo(bx + (boxWidth * 2) / 3, by);
      ctx.lineTo(bx + (boxWidth * 2) / 3, by + boxHeight);
      // Horizs
      ctx.moveTo(bx, by + boxHeight / 3);
      ctx.lineTo(bx + boxWidth, by + boxHeight / 3);
      ctx.moveTo(bx, by + (boxHeight * 2) / 3);
      ctx.lineTo(bx + boxWidth, by + (boxHeight * 2) / 3);
      ctx.stroke();
      ctx.restore();
    }

    // Draw Cinematic Letterbox for Video Editor Mode
    if (currentAppMode === "video" && cinematicLetterbox) {
      ctx.save();
      ctx.fillStyle = "#000000";
      const barHeight = height * 0.12;
      ctx.fillRect(0, 0, width, barHeight);
      ctx.fillRect(0, height - barHeight, width, barHeight);
      ctx.restore();
    }

    // Restore transforms & filters so metadata text is drawn upright and clear
    ctx.restore();

    // 3. DRAW METADATA TEXT OVERLAY
    ctx.save(); // save again for potential sub-overlays or just local bounds
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 24px Outfit, sans-serif";
    ctx.textAlign = "left";
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = 6;
    ctx.fillText(getAssetName(asset).toUpperCase(), 40, 60);

    ctx.font = "500 13px JetBrains Mono, monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fillText(`Asset URI: ${asset.originalUri}`, 40, 95);
    ctx.fillText(
      `Source Time: ${usToSec(active.sourceTimeUs).toFixed(3)}s`,
      40,
      120,
    );
    ctx.fillText(
      `Frame Index: ${timeToFrameIndex(active.sourceTimeUs, asset.metadata.frameRate || seq.frameRate)}`,
      40,
      145,
    );
    ctx.fillText(`Track: ${trackObj?.name || trackObj?.id}`, 40, 170);

    // Draw active effects panel
    if (clipObj.effects.length > 0) {
      ctx.fillStyle = "hsl(262, 80%, 60%)";
      ctx.fillRect(40, 195, 110, 22);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 10px Outfit, sans-serif";
      ctx.fillText("EFFECTS APPLIED", 48, 210);

      ctx.font = "12px JetBrains Mono, monospace";
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      clipObj.effects.forEach((eff, idx) => {
        const check = eff.enabled ? "✔" : "✘";
        ctx.fillText(
          `${check} ${eff.type.split(".").pop()} (id:${eff.id.substring(0, 4)})`,
          40,
          240 + idx * 18,
        );
      });
    }

    ctx.restore();
  }
}

// ==========================================================================
// PREFETCH WORKFLOW VISUALIZER
// ==========================================================================
function updatePrefetchUI() {
  const seq = getActiveSequence();
  if (!seq) {
    prefetchItems.innerHTML = "";
    return;
  }

  const lookAheadUs = "1000000";
  const requests = planPrefetch(seq, playbackState.currentTimeUs, lookAheadUs);

  prefetchItems.innerHTML = requests
    .map((req) => {
      return `<div class="prefetch-item prefetched">
      F${req.frameIndex} (${usToSec(req.sourceTimeUs).toFixed(2)}s)
    </div>`;
    })
    .join("");
}

// ==========================================================================
// UI RE-SYNCHRONIZATION & RENDERING
// ==========================================================================
function updateUI() {
  const project = editorState.project;
  if (!project) {
    projectTitle.textContent = "No Project Loaded";
    return;
  }

  projectTitle.textContent = project.name;

  btnUndo.disabled = editorState.undoStack.length === 0;
  btnRedo.disabled = editorState.redoStack.length === 0;
  historyVersion.textContent = `v${project.currentVersion}`;

  const seq = getActiveSequence();
  if (seq) {
    const durUs = sequenceDurationUs(seq);
    playbackState.durationUs = durUs;
    durationDisplay.textContent = `${usToSec(durUs).toFixed(2)}s`;
  }

  updateTimecodeUI();
  renderMediaBin();
  renderOperationLog();
  renderTimelineTracks();
  renderInspector();
  updatePlayheadUI();
  drawPreview();
  updatePrefetchUI();
}

function updateTimecodeUI() {
  const tUs = playbackState.currentTimeUs;
  currentTimeDisplay.textContent = `${usToSec(tUs).toFixed(2)}s`;
  globalTimecode.textContent = formatTimecode(tUs);

  const seq = getActiveSequence();
  if (seq) {
    const frameIndex = timeToFrameIndex(tUs, seq.frameRate);
    globalFrameDisplay.textContent = `Frame ${frameIndex}`;
  }
}

function updatePlayheadUI() {
  const currentSec = usToSec(playbackState.currentTimeUs);
  const x = currentSec * zoomLevel;
  timelinePlayhead.style.left = `${x}px`;
  drawTimelineRuler();
}

function renderMediaBin() {
  const project = editorState.project;
  if (!project) return;

  const filteredAssets = project.assets.filter((asset) => {
    if (currentAppMode === "photo") {
      return asset.kind === "image";
    } else {
      return asset.kind === "video" || asset.kind === "audio";
    }
  });

  if (filteredAssets.length === 0) {
    mediaList.innerHTML = `<p class="empty-state-text">No ${currentAppMode} assets in this mode.</p>`;
    return;
  }

  mediaList.innerHTML = filteredAssets
    .map((asset) => {
      let specText = "";
      if (asset.kind === "video") {
        specText = `${asset.metadata.width}x${asset.metadata.height} | ${asset.metadata.frameRate?.numerator}/${asset.metadata.frameRate?.denominator}fps`;
      } else if (asset.kind === "image") {
        specText = `${asset.metadata.width}x${asset.metadata.height} | Image`;
      } else if (asset.kind === "audio") {
        specText = `Audio track`;
      }

      const durSec = asset.metadata.durationUs
        ? usToSec(asset.metadata.durationUs).toFixed(1) + "s"
        : "Still";

      return `
      <div class="media-card" draggable="true" data-asset-id="${asset.id}">
        <div class="media-thumb ${asset.kind}">
          ${asset.kind === "video" ? "▶" : asset.kind === "audio" ? "♬" : "📷"}
        </div>
        <div class="media-details">
          <div class="media-title">${getAssetName(asset)}</div>
          <div class="media-meta">${specText}</div>
          <div class="media-duration">${durSec}</div>
        </div>
      </div>
    `;
    })
    .join("");

  mediaList.querySelectorAll(".media-card").forEach((card) => {
    card.addEventListener("dragstart", (e: Event) => {
      const de = e as DragEvent;
      const target = e.currentTarget as HTMLElement;
      de.dataTransfer?.setData("text/plain", target.dataset["assetId"] ?? "");
    });
  });
}

function renderOperationLog() {
  const log = editorState.operationLog;
  const historyIndex = log.length;

  if (log.length === 0) {
    historyList.innerHTML = `<p class="empty-state-text">History is empty. Perform timeline edits to record commands.</p>`;
    return;
  }

  historyList.innerHTML = log
    .map((cmd, idx) => {
      const activeClass = idx === historyIndex - 1 ? "active" : "";
      return `
      <div class="history-card ${activeClass}">
        <div class="history-cmd-type">${cmd.command.commandType}</div>
        <div class="history-cmd-meta">
          <span>v${cmd.baseVersion} → v${cmd.resultingVersion}</span>
          <span>${cmd.command.actor.id}</span>
        </div>
      </div>
    `;
    })
    .join("");
}

function renderTimelineTracks() {
  const seq = getActiveSequence();
  if (!seq) return;

  const tracksToShow = seq.tracks.filter((track) => {
    if (currentAppMode === "photo") {
      return track.kind === "video";
    }
    return true;
  });

  trackHeadersColumn.innerHTML = tracksToShow
    .map((track) => {
      return `
      <div class="track-header-item" data-track-id="${track.id}">
        <span class="track-header-name">${track.name}</span>
        <span class="track-header-kind">${track.kind}</span>
      </div>
    `;
    })
    .join("");

  tracksLanesContainer.innerHTML = tracksToShow
    .map((track) => {
      const clipsHtml = track.clips
        .map((clip) => {
          const asset = editorState.project?.assets.find(
            (a) => a.id === clip.assetId,
          );
          const clipName = getAssetName(asset);
          const startSec = usToSec(clip.timelineStartUs);
          const durSec = usToSec(clip.timelineDurationUs);

          const leftPx = startSec * zoomLevel;
          const widthPx = durSec * zoomLevel;
          const isSelected = clip.id === selectedClipId ? "selected" : "";

          const kindClass = asset ? asset.kind : "video";

          return `
        <div class="clip-block ${kindClass} ${isSelected}" 
             style="left: ${leftPx}px; width: ${widthPx}px;"
             data-clip-id="${clip.id}"
             data-track-id="${track.id}">
          <div class="clip-trim-handle left"></div>
          <span class="clip-label">${clipName}</span>
          <span class="clip-sublabel">${startSec.toFixed(1)}s - ${(startSec + durSec).toFixed(1)}s</span>
          <div class="clip-trim-handle right"></div>
        </div>
      `;
        })
        .join("");

      return `
      <div class="track-lane" data-track-id="${track.id}">
        ${clipsHtml}
      </div>
    `;
    })
    .join("");

  const clipBlocks = tracksLanesContainer.querySelectorAll(".clip-block");
  clipBlocks.forEach((block) => {
    block.addEventListener("mousedown", handleClipMousedown as EventListener);
  });

  const lanes = tracksLanesContainer.querySelectorAll(".track-lane");
  lanes.forEach((lane) => {
    lane.addEventListener("dragover", (e: Event) => {
      e.preventDefault();
      lane.classList.add("dragover");
    });
    lane.addEventListener("dragleave", () => {
      lane.classList.remove("dragover");
    });
    lane.addEventListener("drop", handleTrackLaneDrop);
  });

  btnSplitClip.disabled = selectedClipId === null;
  btnDeleteClip.disabled = selectedClipId === null;
}

function drawTimelineRuler() {
  const rulerWidth = Math.max(tracksLanesContainer.offsetWidth || 1200, 2000);
  rulerCanvas.width = rulerWidth;
  rulerCanvas.height = 28;

  const rCtx = rulerCanvas.getContext("2d")!;
  rCtx.fillStyle = "#0c0c0e";
  rCtx.fillRect(0, 0, rulerCanvas.width, rulerCanvas.height);

  rCtx.strokeStyle = "hsl(240, 5%, 22%)";
  rCtx.lineWidth = 1;
  rCtx.fillStyle = "hsl(240, 4%, 55%)";
  rCtx.font = "9px JetBrains Mono, monospace";
  rCtx.textAlign = "center";

  let labelIntervalSec = 1;
  if (zoomLevel < 35) labelIntervalSec = 5;
  if (zoomLevel < 12) labelIntervalSec = 10;

  const tickIntervalSec = labelIntervalSec / 10;

  const maxDurationSec = usToSec(playbackState.durationUs) + 30;
  const totalTicks = Math.ceil(maxDurationSec / tickIntervalSec);

  for (let i = 0; i <= totalTicks; i++) {
    const sec = i * tickIntervalSec;
    const x = sec * zoomLevel;

    if (x > rulerCanvas.width) break;

    const isLabel =
      Math.abs(sec / labelIntervalSec - Math.round(sec / labelIntervalSec)) <
      0.001;

    rCtx.beginPath();
    rCtx.moveTo(x, 28);
    if (isLabel) {
      rCtx.lineTo(x, 15);
      rCtx.fillText(`${sec.toFixed(0)}s`, x, 11);
    } else {
      rCtx.lineTo(x, 22);
    }
    rCtx.stroke();
  }
}

function renderInspector() {
  const selection = getSelectedClip();

  if (!selection) {
    inspectorContent.innerHTML = `
      <div class="inspector-empty">
        <p class="empty-state-text">Select a timeline clip to inspect properties and manage its effect stack.</p>
      </div>
    `;
    return;
  }

  const { clip } = selection;
  const asset = editorState.project?.assets.find((a) => a.id === clip.assetId);
  const assetName = getAssetName(asset);

  let effectsListHtml = "";
  if (clip.effects.length === 0) {
    effectsListHtml = `<p class="empty-state-text" style="padding: 10px 0;">No effects applied.</p>`;
  } else {
    effectsListHtml = clip.effects
      .map((effect, idx) => {
        let paramsHtml = "";

        if (effect.type === "color.brightness") {
          const val = effect.params.amount;
          paramsHtml = `
          <div class="slider-container">
            <div class="slider-info">
              <span>Amount</span>
              <span class="slider-val">${val.toFixed(2)}</span>
            </div>
            <div class="slider-input-row">
              <input type="range" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="amount" 
                     min="-1" max="1" step="0.05" value="${val}" />
            </div>
          </div>
        `;
        } else if (effect.type === "color.contrast") {
          const val = effect.params.amount;
          paramsHtml = `
          <div class="slider-container">
            <div class="slider-info">
              <span>Amount</span>
              <span class="slider-val">${val.toFixed(2)}</span>
            </div>
            <div class="slider-input-row">
              <input type="range" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="amount" 
                     min="0" max="4" step="0.05" value="${val}" />
            </div>
          </div>
        `;
        } else if (effect.type === "transform.opacity") {
          const val = effect.params.opacity;
          paramsHtml = `
          <div class="slider-container">
            <div class="slider-info">
              <span>Opacity</span>
              <span class="slider-val">${Math.round(val * 100)}%</span>
            </div>
            <div class="slider-input-row">
              <input type="range" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="opacity" 
                     min="0" max="1" step="0.05" value="${val}" />
            </div>
          </div>
        `;
        } else if (effect.type === "blur.gaussian") {
          const val = effect.params.radiusPx;
          paramsHtml = `
          <div class="slider-container">
            <div class="slider-info">
              <span>Radius (px)</span>
              <span class="slider-val">${val}px</span>
            </div>
            <div class="slider-input-row">
              <input type="range" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="radiusPx" 
                     min="0" max="50" step="1" value="${val}" />
            </div>
          </div>
        `;
        } else if (effect.type === "color.grayscale") {
          const val = effect.params.amount;
          paramsHtml = `
          <div class="slider-container">
            <div class="slider-info">
              <span>Grayscale Amount</span>
              <span class="slider-val">${Math.round(val * 100)}%</span>
            </div>
            <div class="slider-input-row">
              <input type="range" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="amount" 
                     min="0" max="1" step="0.05" value="${val}" />
            </div>
          </div>
        `;
        } else if (effect.type === "color.sepia") {
          const val = effect.params.amount;
          paramsHtml = `
          <div class="slider-container">
            <div class="slider-info">
              <span>Sepia Amount</span>
              <span class="slider-val">${Math.round(val * 100)}%</span>
            </div>
            <div class="slider-input-row">
              <input type="range" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="amount" 
                     min="0" max="1" step="0.05" value="${val}" />
            </div>
          </div>
        `;
        } else if (effect.type === "transform.rotate") {
          const val = effect.params.angleDegrees;
          paramsHtml = `
          <div class="slider-container">
            <div class="slider-info">
              <span>Angle</span>
              <span class="slider-val">${val}°</span>
            </div>
            <div class="slider-input-row">
              <input type="range" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="angleDegrees" 
                     min="-360" max="360" step="90" value="${val}" />
            </div>
          </div>
        `;
        } else if (effect.type === "transform.flip") {
          const horiz = effect.params.horizontal;
          const vert = effect.params.vertical;
          paramsHtml = `
          <div class="checkbox-container" style="display:flex; gap:16px; align-items:center; padding: 4px 0;">
            <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer;">
              <input type="checkbox" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="horizontal" 
                     ${horiz ? "checked" : ""} />
              <span>Horizontal</span>
            </label>
            <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer;">
              <input type="checkbox" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="vertical" 
                     ${vert ? "checked" : ""} />
              <span>Vertical</span>
            </label>
          </div>
        `;
        } else if (effect.type === "color.hue_rotate") {
          const val = effect.params.angleDegrees;
          paramsHtml = `
          <div class="slider-container">
            <div class="slider-info">
              <span>Hue Rotation</span>
              <span class="slider-val">${val}°</span>
            </div>
            <div class="slider-input-row">
              <input type="range" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="angleDegrees" 
                     min="-180" max="180" step="5" value="${val}" />
            </div>
          </div>
        `;
        } else if (effect.type === "color.saturate") {
          const val = effect.params.amount;
          paramsHtml = `
          <div class="slider-container">
            <div class="slider-info">
              <span>Saturation</span>
              <span class="slider-val">${Math.round(val * 100)}%</span>
            </div>
            <div class="slider-input-row">
              <input type="range" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="amount" 
                     min="0" max="5" step="0.1" value="${val}" />
            </div>
          </div>
        `;
        } else if (effect.type === "color.invert") {
          const val = effect.params.amount;
          paramsHtml = `
          <div class="slider-container">
            <div class="slider-info">
              <span>Invert Strength</span>
              <span class="slider-val">${Math.round(val * 100)}%</span>
            </div>
            <div class="slider-input-row">
              <input type="range" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="amount" 
                     min="0" max="1" step="0.05" value="${val}" />
            </div>
          </div>
        `;
        } else if (effect.type === "color.vignette") {
          const val = effect.params.amount;
          paramsHtml = `
          <div class="slider-container">
            <div class="slider-info">
              <span>Vignette Strength</span>
              <span class="slider-val">${Math.round(val * 100)}%</span>
            </div>
            <div class="slider-input-row">
              <input type="range" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="amount" 
                     min="0" max="1" step="0.05" value="${val}" />
            </div>
          </div>
        `;
        } else if (effect.type === "color.tint") {
          const color = effect.params.colorHex;
          const val = effect.params.amount;
          paramsHtml = `
          <div class="color-picker-container" style="display:flex; flex-direction:column; gap:8px; padding: 4px 0;">
            <div class="picker-row" style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:12px; color:var(--color-text-muted);">Tint Color</span>
              <input type="color" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="colorHex" 
                     value="${color}" style="background:none; border:none; width:44px; height:24px; cursor:pointer;" />
            </div>
            <div class="slider-container" style="margin-top:4px;">
              <div class="slider-info">
                <span>Opacity / Mix</span>
                <span class="slider-val">${Math.round(val * 100)}%</span>
              </div>
              <div class="slider-input-row">
                <input type="range" class="effect-param-input" 
                       data-effect-id="${effect.id}" data-param="amount" 
                       min="0" max="1" step="0.05" value="${val}" />
              </div>
            </div>
          </div>
        `;
        } else if (effect.type === "color.exposure") {
          const val = effect.params.amount;
          paramsHtml = `
          <div class="slider-container">
            <div class="slider-info">
              <span>Exposure</span>
              <span class="slider-val">${val > 0 ? "+" : ""}${val.toFixed(2)}</span>
            </div>
            <div class="slider-input-row">
              <input type="range" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="amount" 
                     min="-2" max="2" step="0.1" value="${val}" />
            </div>
          </div>
        `;
        } else if (effect.type === "photo.portrait_blur") {
          const rad = effect.params.blurRadiusPx;
          const bokeh = effect.params.bokehStrength;
          const scale = effect.params.subjectScale;
          paramsHtml = `
          <div class="slider-container">
            <div class="slider-info">
              <span>Blur Radius</span>
              <span class="slider-val">${rad}px</span>
            </div>
            <div class="slider-input-row">
              <input type="range" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="blurRadiusPx" 
                     min="0" max="50" step="1" value="${rad}" />
            </div>
          </div>
          <div class="slider-container" style="margin-top:8px;">
            <div class="slider-info">
              <span>Bokeh Strength</span>
              <span class="slider-val">${Math.round(bokeh * 100)}%</span>
            </div>
            <div class="slider-input-row">
              <input type="range" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="bokehStrength" 
                     min="0" max="1" step="0.05" value="${bokeh}" />
            </div>
          </div>
          <div class="slider-container" style="margin-top:8px;">
            <div class="slider-info">
              <span>Subject Zoom</span>
              <span class="slider-val">${Math.round(scale * 100)}%</span>
            </div>
            <div class="slider-input-row">
              <input type="range" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="subjectScale" 
                     min="0.5" max="1.5" step="0.05" value="${scale}" />
            </div>
          </div>
        `;
        } else if (effect.type === "color.duotone") {
          const shadows = effect.params.shadowsHex;
          const highlights = effect.params.highlightsHex;
          paramsHtml = `
          <div class="color-picker-container" style="display:flex; justify-content:space-between; gap:16px; padding: 4px 0;">
            <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--color-text-muted); cursor:pointer;">
              <span>Shadows</span>
              <input type="color" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="shadowsHex" 
                     value="${shadows}" style="background:none; border:none; width:40px; height:24px; cursor:pointer;" />
            </label>
            <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--color-text-muted); cursor:pointer;">
              <span>Highlights</span>
              <input type="color" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="highlightsHex" 
                     value="${highlights}" style="background:none; border:none; width:40px; height:24px; cursor:pointer;" />
            </label>
          </div>
          <div class="duotone-presets" style="display:flex; gap:6px; margin-top:8px; align-items:center;">
            <span style="font-size:10px; color:var(--color-text-muted);">Presets:</span>
            <button class="action-btn secondary tiny btn-duo-preset" data-effect-id="${effect.id}" data-shadows="#2d004d" data-highlights="#ff5a00" style="padding:2px 5px; font-size:9px; border-radius:4px; font-weight:600;">Sunset</button>
            <button class="action-btn secondary tiny btn-duo-preset" data-effect-id="${effect.id}" data-shadows="#001233" data-highlights="#00f2fe" style="padding:2px 5px; font-size:9px; border-radius:4px; font-weight:600;">Ocean</button>
            <button class="action-btn secondary tiny btn-duo-preset" data-effect-id="${effect.id}" data-shadows="#0b2512" data-highlights="#a8ff78" style="padding:2px 5px; font-size:9px; border-radius:4px; font-weight:600;">Forest</button>
            <button class="action-btn secondary tiny btn-duo-preset" data-effect-id="${effect.id}" data-shadows="#200122" data-highlights="#f43b47" style="padding:2px 5px; font-size:9px; border-radius:4px; font-weight:600;">Cyber</button>
          </div>
        `;
        } else if (effect.type === "fx.retro_noise") {
          const amount = effect.params.noiseAmount;
          const spacing = effect.params.scanlineSpacing;
          paramsHtml = `
          <div class="slider-container">
            <div class="slider-info">
              <span>Noise Amount</span>
              <span class="slider-val">${Math.round(amount * 100)}%</span>
            </div>
            <div class="slider-input-row">
              <input type="range" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="noiseAmount" 
                     min="0" max="1" step="0.05" value="${amount}" />
            </div>
          </div>
          <div class="slider-container" style="margin-top:8px;">
            <div class="slider-info">
              <span>Scanline Spacing</span>
              <span class="slider-val">${spacing}px</span>
            </div>
            <div class="slider-input-row">
              <input type="range" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="scanlineSpacing" 
                     min="2" max="20" step="1" value="${spacing}" />
            </div>
          </div>
        `;
        } else if (effect.type === "fx.border") {
          const color = effect.params.borderColorHex;
          const widthVal = effect.params.borderWidthPx;
          paramsHtml = `
          <div class="color-picker-container" style="display:flex; flex-direction:column; gap:8px; padding: 4px 0;">
            <div class="picker-row" style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:12px; color:var(--color-text-muted);">Frame Color</span>
              <input type="color" class="effect-param-input" 
                     data-effect-id="${effect.id}" data-param="borderColorHex" 
                     value="${color}" style="background:none; border:none; width:44px; height:24px; cursor:pointer;" />
            </div>
            <div class="slider-container" style="margin-top:4px;">
              <div class="slider-info">
                <span>Frame Width</span>
                <span class="slider-val">${widthVal}px</span>
              </div>
              <div class="slider-input-row">
                <input type="range" class="effect-param-input" 
                       data-effect-id="${effect.id}" data-param="borderWidthPx" 
                       min="0" max="50" step="1" value="${widthVal}" />
              </div>
            </div>
          </div>
        `;
        }

        return `
        <div class="effect-card" data-effect-id="${effect.id}">
          <div class="effect-card-header">
            <div class="effect-card-title">
              <div class="effect-dot"></div>
              <span>${effect.type.split(".").pop()?.toUpperCase()}</span>
            </div>
            <div class="effect-controls-row">
              <input type="checkbox" class="effect-toggle-checkbox" 
                     data-effect-id="${effect.id}" ${effect.enabled ? "checked" : ""} 
                     title="Toggle effect active state" style="cursor:pointer;" />
              <button class="icon-btn btn-delete-effect" data-effect-id="${effect.id}" title="Delete Effect">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              </button>
            </div>
          </div>
          <div class="effect-card-body">
            ${paramsHtml}
          </div>
          <div class="effect-card-footer" style="display:flex; justify-content:space-between; margin-top:2px;">
            <button class="action-btn secondary small btn-effect-up" data-effect-id="${effect.id}" ${idx === 0 ? "disabled" : ""} title="Move Up">▲</button>
            <button class="action-btn secondary small btn-effect-down" data-effect-id="${effect.id}" ${idx === clip.effects.length - 1 ? "disabled" : ""} title="Move Down">▼</button>
          </div>
        </div>
      `;
      })
      .join("");
  }

  inspectorContent.innerHTML = `
    <div class="inspector-pane">
      <div class="inspector-section">
        <h4>Clip Properties</h4>
        <div class="property-row">
          <span class="property-label">Clip ID</span>
          <span class="property-val" title="${clip.id}">${clip.id.substring(0, 8)}...</span>
        </div>
        <div class="property-row">
          <span class="property-label">Source Asset</span>
          <span class="property-val" title="${assetName}">${assetName}</span>
        </div>
        <div class="property-row">
          <span class="property-label">Start Time</span>
          <span class="property-val">${usToSec(clip.timelineStartUs).toFixed(3)}s</span>
        </div>
        <div class="property-row">
          <span class="property-label">Duration</span>
          <span class="property-val">${usToSec(clip.timelineDurationUs).toFixed(3)}s</span>
        </div>
        <div class="property-row">
          <span class="property-label">Source Range</span>
          <span class="property-val">${usToSec(clip.sourceInUs).toFixed(2)}s - ${usToSec(clip.sourceOutUs).toFixed(2)}s</span>
        </div>
        ${
          currentAppMode === "photo"
            ? `
          <div class="property-row" style="margin-top:10px; display:flex; flex-direction:column; gap:6px; align-items:stretch;">
            <span class="property-label" style="font-size:11px;">Crop Aspect Ratio Guide</span>
            <div style="display:flex; gap:4px;">
              <button class="action-btn small btn-aspect ${photoCropAspect === "none" ? "primary" : "secondary"}" data-aspect="none" style="flex:1; padding:3px 0; font-size:10px;">Free</button>
              <button class="action-btn small btn-aspect ${photoCropAspect === "1:1" ? "primary" : "secondary"}" data-aspect="1:1" style="flex:1; padding:3px 0; font-size:10px;">1:1 Sq</button>
              <button class="action-btn small btn-aspect ${photoCropAspect === "4:5" ? "primary" : "secondary"}" data-aspect="4:5" style="flex:1; padding:3px 0; font-size:10px;">4:5 Pt</button>
              <button class="action-btn small btn-aspect ${photoCropAspect === "16:9" ? "primary" : "secondary"}" data-aspect="16:9" style="flex:1; padding:3px 0; font-size:10px;">16:9 Ld</button>
            </div>
          </div>
          <div class="property-row" style="margin-top:10px; display:flex; flex-direction:column; gap:6px; align-items:stretch;">
            <span class="property-label" style="font-size:11px;">Quick Enhancements</span>
            <button id="btn-auto-enhance" class="action-btn secondary small" style="width:100%; padding:5px 0; font-size:11px; font-weight:600;">⚡ Smart Auto-Enhance</button>
          </div>
        `
            : `
          <div class="property-row" style="margin-top:10px; display:flex; justify-content:space-between; align-items:center;">
            <span class="property-label" style="font-size:11px;">Cinematic Guide</span>
            <label style="display:flex; align-items:center; gap:6px; font-size:11px; cursor:pointer; color:var(--text-main);">
              <input type="checkbox" id="chk-cinematic" ${cinematicLetterbox ? "checked" : ""} style="cursor:pointer;" />
              <span>2.39:1 letterbox</span>
            </label>
          </div>
        `
        }
      </div>

      <div class="inspector-section">
        <div class="effects-header-row">
          <h4>${currentAppMode === "photo" ? "Photo Effects" : "Video Effects"}</h4>
          <select class="add-effect-select" id="select-add-effect">
            <option value="" disabled selected>Add Effect...</option>
            ${
              currentAppMode === "photo"
                ? `
              <option value="color.brightness">Brightness</option>
              <option value="color.contrast">Contrast</option>
              <option value="color.grayscale">Grayscale</option>
              <option value="color.sepia">Sepia</option>
              <option value="color.vignette">Vignette</option>
              <option value="color.tint">Color Tint</option>
              <option value="color.exposure">Exposure</option>
              <option value="photo.portrait_blur">Portrait Background Blur</option>
              <option value="color.duotone">Duotone Filter</option>
              <option value="fx.border">Border & Frame</option>
              <option value="transform.rotate">Rotate</option>
              <option value="transform.flip">Flip</option>
            `
                : `
              <option value="color.brightness">Brightness</option>
              <option value="color.contrast">Contrast</option>
              <option value="transform.opacity">Opacity</option>
              <option value="blur.gaussian">Gaussian Blur</option>
              <option value="color.hue_rotate">Hue Rotation</option>
              <option value="color.saturate">Saturation</option>
              <option value="color.invert">Invert Colors</option>
              <option value="fx.retro_noise">Retro Scanlines & Noise</option>
              <option value="transform.rotate">Rotate</option>
              <option value="transform.flip">Flip</option>
            `
            }
          </select>
        </div>
        <div class="effects-list">
          ${effectsListHtml}
        </div>
      </div>
    </div>
  `;

  inspectorContent.querySelectorAll(".effect-param-input").forEach((input) => {
    input.addEventListener("input", handleEffectParamInput);
    input.addEventListener("change", handleEffectParamInput);
  });

  inspectorContent
    .querySelectorAll(".effect-toggle-checkbox")
    .forEach((chk) => {
      chk.addEventListener("change", handleEffectToggleChange);
    });

  inspectorContent.querySelectorAll(".btn-delete-effect").forEach((btn) => {
    btn.addEventListener("click", handleEffectDelete);
  });

  inspectorContent.querySelectorAll(".btn-effect-up").forEach((btn) => {
    btn.addEventListener("click", () =>
      handleEffectMoveUpDown(btn.getAttribute("data-effect-id")!, -1),
    );
  });
  inspectorContent.querySelectorAll(".btn-effect-down").forEach((btn) => {
    btn.addEventListener("click", () =>
      handleEffectMoveUpDown(btn.getAttribute("data-effect-id")!, 1),
    );
  });

  const selectAddEffect = document.getElementById(
    "select-add-effect",
  ) as HTMLSelectElement;
  if (selectAddEffect) {
    selectAddEffect.addEventListener("change", handleEffectAdd);
  }

  // Bind Crop Aspect Button Clicks
  inspectorContent.querySelectorAll(".btn-aspect").forEach((btn) => {
    btn.addEventListener("click", () => {
      const aspect = btn.getAttribute("data-aspect") as PhotoCropAspect | null;
      photoCropAspect = aspect ?? "none";
      renderInspector();
      drawPreview();
    });
  });

  // Bind Widescreen Letterbox Checkbox
  const chkCinematic = document.getElementById(
    "chk-cinematic",
  ) as HTMLInputElement | null;
  if (chkCinematic) {
    chkCinematic.addEventListener("change", () => {
      cinematicLetterbox = chkCinematic.checked;
      drawPreview();
    });
  }

  // Find track helper
  const getClipTrack = (clipId: string) => {
    const seq = getActiveSequence();
    return seq?.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  };

  // Bind Smart Auto-Enhance Button
  const btnAutoEnhance = document.getElementById(
    "btn-auto-enhance",
  ) as HTMLButtonElement | null;
  if (btnAutoEnhance) {
    btnAutoEnhance.addEventListener("click", () => {
      const track = getClipTrack(clip.id);
      if (!track) return;

      const effectKeys: EffectType[] = [
        "color.brightness",
        "color.contrast",
        "color.saturate",
      ];
      const newEffects = [...clip.effects];

      for (const key of effectKeys) {
        const fxIndex = newEffects.findIndex((e) => e.type === key);
        let defaultParams: Record<string, number> = {};
        if (key === "color.brightness") defaultParams = { amount: 0.1 };
        else if (key === "color.contrast") defaultParams = { amount: 1.15 };
        else if (key === "color.saturate") defaultParams = { amount: 1.25 };

        if (fxIndex === -1) {
          // Add effect. The construction is dynamic (params shape depends on the
          // runtime type), so it is asserted to EffectInstance here.
          newEffects.push({
            id: `effect-${crypto.randomUUID().substring(0, 8)}`,
            type: key,
            enabled: true,
            params: defaultParams,
          } as unknown as EffectInstance);
        } else {
          // Update effect
          newEffects[fxIndex] = {
            ...newEffects[fxIndex]!,
            params: defaultParams,
          } as unknown as EffectInstance;
        }
      }

      dispatch("timeline.update_clip_effects", {
        sequenceId: activeSequenceId,
        clipId: clip.id,
        effects: newEffects,
      });
      updateUI();
    });
  }

  // Bind Duotone Preset swatches
  inspectorContent.querySelectorAll(".btn-duo-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const effectId = btn.getAttribute("data-effect-id")!;
      const shadows = btn.getAttribute("data-shadows")!;
      const highlights = btn.getAttribute("data-highlights")!;
      const track = getClipTrack(clip.id);
      if (!track) return;

      const updatedEffects = clip.effects.map((e) => {
        if (e.id === effectId) {
          return {
            ...e,
            params: {
              shadowsHex: shadows,
              highlightsHex: highlights,
            },
          };
        }
        return e;
      });

      dispatch("timeline.update_clip_effects", {
        sequenceId: activeSequenceId,
        clipId: clip.id,
        effects: updatedEffects,
      });
      updateUI();
    });
  });
}

// ==========================================================================
// DRAG AND DROP & INPUT EVENT HANDLERS
// ==========================================================================

function handleTrackLaneDrop(e: Event) {
  e.preventDefault();
  const de = e as DragEvent;
  const lane = e.currentTarget as HTMLElement;
  lane.classList.remove("dragover");

  const assetId = de.dataTransfer?.getData("text/plain");
  if (!assetId) return;

  const asset = editorState.project?.assets.find((a) => a.id === assetId);
  if (!asset) return;

  const trackId = lane.dataset["trackId"]!;

  const rect = lane.getBoundingClientRect();
  const dropX = de.clientX - rect.left + timelineGridScroller.scrollLeft;
  const startSec = Math.max(0, dropX / zoomLevel);

  const durationUs = asset.metadata.durationUs || "5000000";
  const startUs = secToUsStr(startSec);

  dispatch("timeline.add_clip", {
    sequenceId: activeSequenceId,
    trackId,
    clip: {
      id: crypto.randomUUID(),
      assetId,
      timelineStartUs: startUs,
      sourceInUs: "0",
      sourceOutUs: durationUs,
      playbackRate: { numerator: 1, denominator: 1 },
    },
  });
}

function handleClipMousedown(e: MouseEvent) {
  e.stopPropagation();
  const target = e.target as HTMLElement;
  const block = target.closest(".clip-block") as HTMLElement;
  if (!block) return;

  const clipId = block.dataset.clipId!;
  selectedClipId = clipId;
  updateUI();

  const selection = getSelectedClip();
  if (!selection) return;
  const { clip, track } = selection;

  let dragType: "move" | "trim-left" | "trim-right" = "move";
  if (target.classList.contains("clip-trim-handle")) {
    dragType = target.classList.contains("left") ? "trim-left" : "trim-right";
  }

  activeDrag = {
    clipId,
    originalTrackId: track.id,
    originalStartUs: clip.timelineStartUs,
    originalSourceInUs: clip.sourceInUs,
    originalSourceOutUs: clip.sourceOutUs,
    originalDurationUs: clip.timelineDurationUs,
    dragType,
    startX: e.clientX,
  };

  block.classList.add("dragging");
  document.body.style.cursor = "ew-resize";

  window.addEventListener("mousemove", handleClipMousemove);
  window.addEventListener("mouseup", handleClipMouseup);
}

function handleClipMousemove(e: MouseEvent) {
  if (!activeDrag) return;

  const deltaX = e.clientX - activeDrag.startX;
  const deltaSec = deltaX / zoomLevel;

  const block = document.querySelector(
    `.clip-block[data-clip-id="${activeDrag.clipId}"]`,
  ) as HTMLElement;
  if (!block) return;

  const startSec = usToSec(activeDrag.originalStartUs);
  const durSec = usToSec(activeDrag.originalDurationUs);

  if (activeDrag.dragType === "move") {
    const nextStartSec = Math.max(0, startSec + deltaSec);
    block.style.left = `${nextStartSec * zoomLevel}px`;
    block.querySelector(".clip-sublabel")!.textContent =
      `${nextStartSec.toFixed(1)}s - ${(nextStartSec + durSec).toFixed(1)}s`;
  } else if (activeDrag.dragType === "trim-left") {
    const nextStartSec = Math.min(
      startSec + durSec - 0.2,
      Math.max(0, startSec + deltaSec),
    );
    const nextDurSec = startSec + durSec - nextStartSec;
    block.style.left = `${nextStartSec * zoomLevel}px`;
    block.style.width = `${nextDurSec * zoomLevel}px`;
    block.querySelector(".clip-sublabel")!.textContent =
      `${nextStartSec.toFixed(1)}s - ${(startSec + durSec).toFixed(1)}s`;
  } else if (activeDrag.dragType === "trim-right") {
    const nextDurSec = Math.max(0.2, durSec + deltaSec);
    block.style.width = `${nextDurSec * zoomLevel}px`;
    block.querySelector(".clip-sublabel")!.textContent =
      `${startSec.toFixed(1)}s - ${(startSec + nextDurSec).toFixed(1)}s`;
  }
}

function handleClipMouseup(e: MouseEvent) {
  if (!dragDataReady()) return;

  const drag = activeDrag!;
  activeDrag = null;

  document.body.style.cursor = "default";
  const block = document.querySelector(
    `.clip-block[data-clip-id="${drag.clipId}"]`,
  ) as HTMLElement;
  if (block) block.classList.remove("dragging");

  window.removeEventListener("mousemove", handleClipMousemove);
  window.removeEventListener("mouseup", handleClipMouseup);

  const deltaX = e.clientX - drag.startX;
  const deltaSec = deltaX / zoomLevel;
  const deltaUs = Math.round(deltaSec * 1_000_000);

  if (drag.dragType === "move") {
    const nextStartUs = BigInt(drag.originalStartUs) + BigInt(deltaUs);
    const finalStartUs = nextStartUs < 0n ? "0" : nextStartUs.toString();

    let targetTrackId = drag.originalTrackId;
    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    const lane = elements.find((el: Element) =>
      el.classList.contains("track-lane"),
    ) as HTMLElement | undefined;
    if (lane) {
      targetTrackId = lane.dataset.trackId!;
    }

    dispatch("timeline.move_clip", {
      sequenceId: activeSequenceId,
      clipId: drag.clipId,
      targetTrackId,
      timelineStartUs: finalStartUs,
    });
  } else if (drag.dragType === "trim-left") {
    const newStartUs = BigInt(drag.originalStartUs) + BigInt(deltaUs);
    const finalStartUs = newStartUs < 0n ? "0" : newStartUs.toString();
    const actualDeltaUs = BigInt(finalStartUs) - BigInt(drag.originalStartUs);

    const newSourceInUs = BigInt(drag.originalSourceInUs) + actualDeltaUs;

    const trimOk = dispatch("timeline.trim_clip", {
      sequenceId: activeSequenceId,
      clipId: drag.clipId,
      sourceInUs: newSourceInUs.toString(),
      sourceOutUs: drag.originalSourceOutUs,
    });

    if (trimOk) {
      dispatch("timeline.move_clip", {
        sequenceId: activeSequenceId,
        clipId: drag.clipId,
        targetTrackId: drag.originalTrackId,
        timelineStartUs: finalStartUs,
      });
    }
  } else if (drag.dragType === "trim-right") {
    const newSourceOutUs = BigInt(drag.originalSourceOutUs) + BigInt(deltaUs);

    dispatch("timeline.trim_clip", {
      sequenceId: activeSequenceId,
      clipId: drag.clipId,
      sourceInUs: drag.originalSourceInUs,
      sourceOutUs: newSourceOutUs.toString(),
    });
  }
}

function dragDataReady(): boolean {
  return activeDrag !== null;
}

function handleEffectParamInput(e: Event) {
  const input = e.target as HTMLInputElement;
  const effectId = input.dataset.effectId!;
  const param = input.dataset.param!;
  const value =
    input.type === "checkbox"
      ? input.checked
      : input.type === "color"
        ? input.value
        : parseFloat(input.value);

  const selection = getSelectedClip();
  if (!selection) return;

  const effect = selection.clip.effects.find((eff) => eff.id === effectId);
  if (!effect) return;

  const params: Record<string, string | number | boolean> = {
    ...effect.params,
  };
  params[param] = value;

  dispatch("timeline.update_effect_params", {
    sequenceId: activeSequenceId,
    clipId: selection.clip.id,
    effectId,
    params,
  });
}

function handleEffectToggleChange(e: Event) {
  const chk = e.target as HTMLInputElement;
  const effectId = chk.dataset.effectId!;
  const enabled = chk.checked;

  const selection = getSelectedClip();
  if (!selection) return;

  const effect = selection.clip.effects.find((eff) => eff.id === effectId);
  if (!effect) return;

  const removeOk = dispatch("timeline.remove_effect", {
    sequenceId: activeSequenceId,
    clipId: selection.clip.id,
    effectId,
  });

  if (removeOk) {
    const toggledEffect: EffectInstance = {
      ...effect,
      enabled,
    };
    dispatch("timeline.add_effect", {
      sequenceId: activeSequenceId,
      clipId: selection.clip.id,
      effect: toggledEffect,
    });

    const seq = getActiveSequence();
    const updatedClip = seq?.tracks
      .find((t) => t.id === selection.track.id)
      ?.clips.find((c) => c.id === selection.clip.id);
    if (updatedClip && updatedClip.effects.length > 1) {
      const currentOrder = updatedClip.effects.map((e) => e.id);
      const priorIds = selection.clip.effects.map((e) => e.id);
      const newOrder = priorIds.filter((id) => currentOrder.includes(id));
      dispatch("timeline.reorder_effects", {
        sequenceId: activeSequenceId,
        clipId: selection.clip.id,
        order: newOrder,
      });
    }
  }
}

function handleEffectDelete(e: Event) {
  const btn = e.currentTarget as HTMLElement;
  const effectId = btn.getAttribute("data-effect-id")!;

  const selection = getSelectedClip();
  if (!selection) return;

  dispatch("timeline.remove_effect", {
    sequenceId: activeSequenceId,
    clipId: selection.clip.id,
    effectId,
  });
}

function handleEffectMoveUpDown(effectId: string, direction: number) {
  const selection = getSelectedClip();
  if (!selection) return;

  const effects = selection.clip.effects;
  const idx = effects.findIndex((e) => e.id === effectId);
  if (idx < 0) return;

  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= effects.length) return;

  const nextOrder = effects.map((e) => e.id);
  const temp = nextOrder[idx]!;
  nextOrder[idx] = nextOrder[targetIdx]!;
  nextOrder[targetIdx] = temp;

  dispatch("timeline.reorder_effects", {
    sequenceId: activeSequenceId,
    clipId: selection.clip.id,
    order: nextOrder,
  });
}

function handleEffectAdd(e: Event) {
  const select = e.target as HTMLSelectElement;
  const type = select.value as EffectType;
  if (!type) return;

  const selection = getSelectedClip();
  if (!selection) return;

  let params: Record<string, string | number | boolean> = {};
  if (type === "color.brightness") params = { amount: 0.0 };
  else if (type === "color.contrast") params = { amount: 1.0 };
  else if (type === "transform.opacity") params = { opacity: 1.0 };
  else if (type === "blur.gaussian") params = { radiusPx: 5 };
  else if (type === "color.grayscale") params = { amount: 1.0 };
  else if (type === "color.sepia") params = { amount: 1.0 };
  else if (type === "transform.rotate") params = { angleDegrees: 0.0 };
  else if (type === "transform.flip")
    params = { horizontal: false, vertical: false };
  else if (type === "color.hue_rotate") params = { angleDegrees: 0.0 };
  else if (type === "color.saturate") params = { amount: 1.0 };
  else if (type === "color.invert") params = { amount: 0.0 };
  else if (type === "color.vignette") params = { amount: 0.5 };
  else if (type === "color.tint") params = { colorHex: "#ff0000", amount: 0.2 };
  else if (type === "color.exposure") params = { amount: 0.0 };
  else if (type === "photo.portrait_blur")
    params = { blurRadiusPx: 15, bokehStrength: 0.4, subjectScale: 1.0 };
  else if (type === "color.duotone")
    params = { shadowsHex: "#2d004d", highlightsHex: "#ff5a00" };
  else if (type === "fx.retro_noise")
    params = { noiseAmount: 0.25, scanlineSpacing: 6 };
  else if (type === "fx.border")
    params = { borderColorHex: "#ffffff", borderWidthPx: 12 };

  // params shape is chosen per runtime type above; asserted to EffectInstance.
  const newEffect = {
    id: `effect-${crypto.randomUUID().substring(0, 8)}`,
    type,
    enabled: true,
    params,
  } as unknown as EffectInstance;

  dispatch("timeline.add_effect", {
    sequenceId: activeSequenceId,
    clipId: selection.clip.id,
    effect: newEffect,
  });

  select.value = "";
}

function handleSplitSelectedClip() {
  const selection = getSelectedClip();
  if (!selection) return;

  const { clip, track } = selection;
  const playheadUs = playbackState.currentTimeUs;

  const clipStart = BigInt(clip.timelineStartUs);
  const clipEnd = clipStart + BigInt(clip.timelineDurationUs);
  const splitT = BigInt(playheadUs);

  if (splitT <= clipStart || splitT >= clipEnd) {
    alert("Playhead must be inside the selected clip to split it.");
    return;
  }

  const offsetUs = splitT - clipStart;
  const splitSourceOutUs = BigInt(clip.sourceInUs) + offsetUs;

  const secondStartUs = splitT.toString();
  const secondSourceInUs = splitSourceOutUs.toString();
  const secondSourceOutUs = clip.sourceOutUs;

  const trimOk = dispatch("timeline.trim_clip", {
    sequenceId: activeSequenceId,
    clipId: clip.id,
    sourceInUs: clip.sourceInUs,
    sourceOutUs: splitSourceOutUs.toString(),
  });

  if (trimOk) {
    const secondClipId = crypto.randomUUID();
    dispatch("timeline.add_clip", {
      sequenceId: activeSequenceId,
      trackId: track.id,
      clip: {
        id: secondClipId,
        assetId: clip.assetId,
        timelineStartUs: secondStartUs,
        sourceInUs: secondSourceInUs,
        sourceOutUs: secondSourceOutUs,
        playbackRate: { numerator: 1, denominator: 1 },
      },
    });

    selectedClipId = secondClipId;
    updateUI();
  }
}

function handleDeleteSelectedClip() {
  if (!selectedClipId) return;

  const clipId = selectedClipId;
  selectedClipId = null;

  dispatch("timeline.delete_clip", {
    sequenceId: activeSequenceId,
    clipId,
  });
}

// ==========================================================================
// PLAYBACK / TRANSPORT CONTROLLER INTERACTIVITY
// ==========================================================================
let lastTickTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  if (playbackState.playing) {
    const elapsedMs = now - lastTickTime;
    const deltaUs = Math.round(elapsedMs * 1000).toString();

    playbackState = tick(playbackState, deltaUs);

    if (!playbackState.playing) {
      playIcon.classList.remove("hidden");
      pauseIcon.classList.add("hidden");
    }

    updateTimecodeUI();
    updatePlayheadUI();
    drawPreview();
    updatePrefetchUI();
  }

  lastTickTime = now;
}

function handlePlayPause() {
  if (playbackState.playing) {
    playbackState = pause(playbackState);
    playIcon.classList.remove("hidden");
    pauseIcon.classList.add("hidden");
  } else {
    if (
      BigInt(playbackState.currentTimeUs) >= BigInt(playbackState.durationUs)
    ) {
      playbackState = seek(playbackState, "0");
    }
    playbackState = play(playbackState);
    playIcon.classList.add("hidden");
    pauseIcon.classList.remove("hidden");
    lastTickTime = performance.now();
  }
  updateUI();
}

function handleJogFrame(direction: number) {
  const seq = getActiveSequence();
  if (!seq) return;

  const currentUs = playbackState.currentTimeUs;
  const currentFrame = timeToFrameIndex(currentUs, seq.frameRate);

  const nextFrame = Math.max(0, currentFrame + direction);
  const nextUs = frameToStartTimeUs(nextFrame, seq.frameRate);

  playbackState = seek(playbackState, nextUs);
  updateUI();
}

function handleTimelineSeek(e: MouseEvent) {
  const rect = timelineRuler.getBoundingClientRect();
  const clickX = e.clientX - rect.left + timelineGridScroller.scrollLeft;
  const sec = clickX / zoomLevel;
  const us = secToUsStr(Math.max(0, sec));

  playbackState = seek(playbackState, us);
  updateUI();
}

function handleLoopRegionApply() {
  const startVal = parseFloat(loopStartInput.value);
  const endVal = parseFloat(loopEndInput.value);

  if (isNaN(startVal) || isNaN(endVal) || startVal >= endVal) {
    alert("Loop start must be strictly less than end.");
    return;
  }

  try {
    playbackState = setLoopRegion(playbackState, {
      startUs: secToUsStr(startVal),
      endUs: secToUsStr(endVal),
    });

    let loopOverlay = document.getElementById("loop-visual-overlay");
    if (!loopOverlay) {
      loopOverlay = document.createElement("div");
      loopOverlay.id = "loop-visual-overlay";
      loopOverlay.className = "timeline-loop-overlay";
      tracksLanesContainer.appendChild(loopOverlay);
    }
    loopOverlay.style.left = `${startVal * zoomLevel}px`;
    loopOverlay.style.width = `${(endVal - startVal) * zoomLevel}px`;

    updateUI();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    alert(`Invalid loop: ${message}`);
  }
}

function handleLoopRegionClear() {
  playbackState = setLoopRegion(playbackState, null);
  const loopOverlay = document.getElementById("loop-visual-overlay");
  if (loopOverlay) loopOverlay.remove();

  loopStartInput.value = "";
  loopEndInput.value = "";
  updateUI();
}

// ==========================================================================
// BOOTSTRAP INITIAL DEMO TIMELINE STATE
// ==========================================================================
function setupInitialProject() {
  dispatch("project.create", {
    projectId: activeProjectId,
    ownerId: "user-1",
    name: "Demo Video Project",
    settings: { defaultFrameRate: { numerator: 30, denominator: 1 } },
  });

  dispatch("timeline.create_sequence", {
    sequence: {
      id: activeSequenceId,
      name: "Main Timeline",
      width: 1920,
      height: 1080,
      frameRate: { numerator: 30, denominator: 1 },
    },
  });

  dispatch("timeline.add_track", {
    sequenceId: activeSequenceId,
    track: { id: "track-v1", kind: "video", name: "V1 (Video 1)", index: 0 },
  });
  dispatch("timeline.add_track", {
    sequenceId: activeSequenceId,
    track: { id: "track-a1", kind: "audio", name: "A1 (Audio 1)", index: 1 },
  });

  dispatch("asset.register", {
    asset: {
      id: "asset-video-1",
      projectId: activeProjectId,
      kind: "video",
      originalUri: "file:///media/sunset_beach.mp4",
      checksum:
        "0000000000000000000000000000000000000000000000000000000000000001",
      metadata: {
        fileSizeBytes: "12485760",
        durationUs: "15000000",
        width: 1920,
        height: 1080,
        frameRate: { numerator: 30, denominator: 1 },
      },
      createdAt: new Date().toISOString(),
    },
  });

  dispatch("asset.register", {
    asset: {
      id: "asset-video-2",
      projectId: activeProjectId,
      kind: "video",
      originalUri: "file:///media/tokyo_timelapse.mp4",
      checksum:
        "0000000000000000000000000000000000000000000000000000000000000002",
      metadata: {
        fileSizeBytes: "18400000",
        durationUs: "10000000",
        width: 3840,
        height: 2160,
        frameRate: { numerator: 30, denominator: 1 },
      },
      createdAt: new Date().toISOString(),
    },
  });

  dispatch("asset.register", {
    asset: {
      id: "asset-audio-1",
      projectId: activeProjectId,
      kind: "audio",
      originalUri: "file:///media/forest_ambience.wav",
      checksum:
        "0000000000000000000000000000000000000000000000000000000000000003",
      metadata: {
        fileSizeBytes: "4500000",
        durationUs: "20000000",
        frameRate: { numerator: 30, denominator: 1 },
      },
      createdAt: new Date().toISOString(),
    },
  });

  dispatch("timeline.add_clip", {
    sequenceId: activeSequenceId,
    trackId: "track-v1",
    clip: {
      id: "clip-1",
      assetId: "asset-video-1",
      timelineStartUs: "0",
      sourceInUs: "0",
      sourceOutUs: "6000000",
      playbackRate: { numerator: 1, denominator: 1 },
    },
  });

  dispatch("timeline.add_clip", {
    sequenceId: activeSequenceId,
    trackId: "track-v1",
    clip: {
      id: "clip-2",
      assetId: "asset-video-2",
      timelineStartUs: "7000000",
      sourceInUs: "0",
      sourceOutUs: "5000000",
      playbackRate: { numerator: 1, denominator: 1 },
    },
  });

  dispatch("timeline.add_clip", {
    sequenceId: activeSequenceId,
    trackId: "track-a1",
    clip: {
      id: "clip-3",
      assetId: "asset-audio-1",
      timelineStartUs: "1000000",
      sourceInUs: "0",
      sourceOutUs: "10000000",
      playbackRate: { numerator: 1, denominator: 1 },
    },
  });

  dispatch("asset.register", {
    asset: {
      id: "asset-image-1",
      projectId: activeProjectId,
      kind: "image",
      originalUri: "file:///media/mountain_peak.png",
      checksum:
        "0000000000000000000000000000000000000000000000000000000000000004",
      metadata: {
        fileSizeBytes: "1024500",
        durationUs: "8000000",
        width: 1920,
        height: 1080,
      },
      createdAt: new Date().toISOString(),
    },
  });

  dispatch("timeline.add_clip", {
    sequenceId: activeSequenceId,
    trackId: "track-v1",
    clip: {
      id: "clip-4",
      assetId: "asset-image-1",
      timelineStartUs: "13000000",
      sourceInUs: "0",
      sourceOutUs: "8000000",
      playbackRate: { numerator: 1, denominator: 1 },
    },
  });
}

// ==========================================================================
// MEDIA BIN IMPORT FORM SUBMISSION
// ==========================================================================
function handleImportSubmit(e: Event) {
  e.preventDefault();

  // Read but currently unused: MediaAsset has no display-name field yet.
  const _name = (document.getElementById("asset-name") as HTMLInputElement)
    .value;
  const kind = (document.getElementById("asset-kind") as HTMLSelectElement)
    .value as MediaAsset["kind"];
  const uri = (document.getElementById("asset-uri") as HTMLInputElement).value;
  const durationSec = parseFloat(
    (document.getElementById("asset-duration") as HTMLInputElement).value,
  );
  const fps = parseFloat(
    (document.getElementById("asset-framerate") as HTMLSelectElement).value,
  );
  const width = parseInt(
    (document.getElementById("asset-width") as HTMLInputElement).value,
  );
  const height = parseInt(
    (document.getElementById("asset-height") as HTMLInputElement).value,
  );

  let num = 30;
  let den = 1;
  if (fps === 24) num = 24;
  else if (fps === 60) num = 60;
  else if (fps === 29.97) {
    num = 30000;
    den = 1001;
  }

  const metadata: AssetMetadata = {
    fileSizeBytes: "1000000",
    durationUs: secToUsStr(durationSec),
    frameRate: { numerator: num, denominator: den },
  };
  if (kind !== "audio") {
    metadata.width = width || 1920;
    metadata.height = height || 1080;
  }

  const assetId = `asset-${crypto.randomUUID().substring(0, 8)}`;

  const success = dispatch("asset.register", {
    asset: {
      id: assetId,
      projectId: activeProjectId,
      kind,
      originalUri: uri,
      checksum: crypto.randomUUID().replaceAll("-", ""),
      metadata,
      createdAt: new Date().toISOString(),
    },
  });

  if (success) {
    closeImportModal();
    importForm.reset();
  }
}

function handleFilePickerChange(e: Event) {
  const picker = e.target as HTMLInputElement;
  if (!picker.files || picker.files.length === 0) return;
  const file = picker.files[0]!;

  const nameInput = document.getElementById("asset-name") as HTMLInputElement;
  const kindSelect = document.getElementById("asset-kind") as HTMLSelectElement;
  const uriInput = document.getElementById("asset-uri") as HTMLInputElement;
  const durationInput = document.getElementById(
    "asset-duration",
  ) as HTMLInputElement;
  const widthInput = document.getElementById("asset-width") as HTMLInputElement;
  const heightInput = document.getElementById(
    "asset-height",
  ) as HTMLInputElement;

  nameInput.value = file.name;
  const blobUrl = URL.createObjectURL(file);
  uriInput.value = blobUrl;

  if (file.type.startsWith("image/")) {
    kindSelect.value = "image";
    durationInput.value = "10.0";
    const img = new Image();
    img.src = blobUrl;
    img.onload = () => {
      widthInput.value = img.naturalWidth.toString();
      heightInput.value = img.naturalHeight.toString();
    };
  } else if (file.type.startsWith("video/")) {
    kindSelect.value = "video";
    const vid = document.createElement("video");
    vid.src = blobUrl;
    vid.preload = "metadata";
    vid.onloadedmetadata = () => {
      durationInput.value = vid.duration.toFixed(2);
      widthInput.value = vid.videoWidth.toString();
      heightInput.value = vid.videoHeight.toString();
    };
  } else if (file.type.startsWith("audio/")) {
    kindSelect.value = "audio";
    const aud = document.createElement("audio");
    aud.src = blobUrl;
    aud.preload = "metadata";
    aud.onloadedmetadata = () => {
      durationInput.value = aud.duration.toFixed(2);
      widthInput.value = "";
      heightInput.value = "";
    };
  }
}

function handleDirectFileUploaderChange(e: Event) {
  const picker = e.target as HTMLInputElement;
  if (!picker.files || picker.files.length === 0) return;
  const file = picker.files[0]!;
  handleDirectUpload(file);
}

async function handleDirectUpload(file: File) {
  if (currentAppMode === "photo" && !file.type.startsWith("image/")) {
    alert(
      "Error: Only photo/image files can be uploaded in Photo Editor mode.",
    );
    return;
  }
  const assetId = `asset-${crypto.randomUUID().substring(0, 8)}`;
  const blobUrl = URL.createObjectURL(file);

  let kind: "image" | "video" | "audio" = "image";
  if (file.type.startsWith("video/")) kind = "video";
  else if (file.type.startsWith("audio/")) kind = "audio";

  let width = 1920;
  let height = 1080;
  let durationUs = "10000000";

  if (kind === "image") {
    const img = new Image();
    img.src = blobUrl;
    await new Promise<void>((resolve) => {
      img.onload = () => {
        width = img.naturalWidth;
        height = img.naturalHeight;
        resolve();
      };
      img.onerror = () => resolve();
    });
  } else if (kind === "video") {
    const vid = document.createElement("video");
    vid.src = blobUrl;
    vid.preload = "metadata";
    await new Promise<void>((resolve) => {
      vid.onloadedmetadata = () => {
        durationUs = secToUsStr(vid.duration);
        width = vid.videoWidth;
        height = vid.videoHeight;
        resolve();
      };
      vid.onerror = () => resolve();
    });
  } else if (kind === "audio") {
    const aud = document.createElement("audio");
    aud.src = blobUrl;
    aud.preload = "metadata";
    await new Promise<void>((resolve) => {
      aud.onloadedmetadata = () => {
        durationUs = secToUsStr(aud.duration);
        resolve();
      };
      aud.onerror = () => resolve();
    });
  }

  const metadata: AssetMetadata = {
    fileSizeBytes: file.size.toString(),
    durationUs,
    frameRate: { numerator: 30, denominator: 1 },
  };
  if (kind !== "audio") {
    metadata.width = width;
    metadata.height = height;
  }

  dispatch("asset.register", {
    asset: {
      id: assetId,
      projectId: activeProjectId,
      kind,
      originalUri: blobUrl,
      checksum: crypto.randomUUID().replaceAll("-", ""),
      metadata,
      createdAt: new Date().toISOString(),
    },
  });

  updateUI();
}

// Currently unwired: the import button opens the direct file uploader instead.
// Retained for the mock-template import flow.
function _openImportModal() {
  importModal.classList.remove("hidden");
  const filteredTemplates = MOCK_ASSET_TEMPLATES.filter((t) => {
    if (currentAppMode === "photo") {
      return t.kind === "image";
    }
    return t.kind === "video" || t.kind === "audio";
  });
  const template = (filteredTemplates[
    Math.floor(Math.random() * filteredTemplates.length)
  ] || MOCK_ASSET_TEMPLATES[0])!;
  const nameInput = document.getElementById("asset-name") as HTMLInputElement;
  const prefix = crypto.randomUUID().substring(0, 4);
  nameInput.value = `${prefix}_${template.name}`;

  (document.getElementById("asset-kind") as HTMLSelectElement).value =
    template.kind;
  (document.getElementById("asset-uri") as HTMLInputElement).value =
    `file:///media/imported_${prefix}_${template.name}`;
  (document.getElementById("asset-duration") as HTMLInputElement).value =
    template.duration.toString();

  if (template.width) {
    (document.getElementById("asset-width") as HTMLInputElement).value =
      template.width.toString();
    (document.getElementById("asset-height") as HTMLInputElement).value =
      template.height.toString();
  } else {
    (document.getElementById("asset-width") as HTMLInputElement).value = "";
    (document.getElementById("asset-height") as HTMLInputElement).value = "";
  }
}

function closeImportModal() {
  importModal.classList.add("hidden");
}

// ==========================================================================
// EVENT LISTENERS BINDING
// ==========================================================================
function bindEvents() {
  const btnModeVideo = document.getElementById(
    "btn-mode-video",
  ) as HTMLButtonElement | null;
  const btnModePhoto = document.getElementById(
    "btn-mode-photo",
  ) as HTMLButtonElement | null;

  if (btnModeVideo && btnModePhoto) {
    btnModeVideo.addEventListener("click", () => {
      if (currentAppMode === "video") return;
      currentAppMode = "video";
      btnModeVideo.classList.add("active");
      btnModePhoto.classList.remove("active");
      document.getElementById("app-container")?.classList.remove("mode-photo");
      document.getElementById("app-container")?.classList.add("mode-video");

      // Update upload accept pattern restrictions
      const directUp = document.getElementById(
        "direct-file-uploader",
      ) as HTMLInputElement | null;
      if (directUp) directUp.accept = "video/*,image/*,audio/*";
      const modalUp = document.getElementById(
        "asset-file-picker",
      ) as HTMLInputElement | null;
      if (modalUp) modalUp.accept = "video/*,image/*,audio/*";

      playbackState = pause(playbackState);
      btnTogglePlay.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

      updateUI();
    });

    btnModePhoto.addEventListener("click", () => {
      if (currentAppMode === "photo") return;
      currentAppMode = "photo";
      btnModePhoto.classList.add("active");
      btnModeVideo.classList.remove("active");
      document.getElementById("app-container")?.classList.add("mode-photo");
      document.getElementById("app-container")?.classList.remove("mode-video");

      // Update upload accept pattern restrictions
      const directUp = document.getElementById(
        "direct-file-uploader",
      ) as HTMLInputElement | null;
      if (directUp) directUp.accept = "image/*";
      const modalUp = document.getElementById(
        "asset-file-picker",
      ) as HTMLInputElement | null;
      if (modalUp) modalUp.accept = "image/*";

      playbackState = pause(playbackState);
      btnTogglePlay.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

      updateUI();
    });
  }

  btnUndo.addEventListener("click", handleUndo);
  btnRedo.addEventListener("click", handleRedo);
  btnReplayLog.addEventListener("click", runStepByStepReplay);

  btnTogglePlay.addEventListener("click", handlePlayPause);
  btnPrevFrame.addEventListener("click", () => handleJogFrame(-1));
  btnNextFrame.addEventListener("click", () => handleJogFrame(1));

  selectPlaybackRate.addEventListener("change", () => {
    const r = parseFloat(selectPlaybackRate.value);
    let num = 1;
    let den = 1;
    if (r === 0.25) {
      num = 1;
      den = 4;
    } else if (r === 0.5) {
      num = 1;
      den = 2;
    } else if (r === 2.0) {
      num = 2;
      den = 1;
    } else if (r === 4.0) {
      num = 4;
      den = 1;
    }
    playbackState = setRate(playbackState, {
      numerator: num,
      denominator: den,
    });
  });

  btnToggleLoop.addEventListener("click", () => {
    isLoopEnabled = !isLoopEnabled;
    btnToggleLoop.classList.toggle("active", isLoopEnabled);
    loopInputs.classList.toggle("hidden", !isLoopEnabled);
    if (!isLoopEnabled) {
      handleLoopRegionClear();
    }
  });

  btnApplyLoop.addEventListener("click", handleLoopRegionApply);
  btnClearLoop.addEventListener("click", handleLoopRegionClear);

  timelineZoomSlider.addEventListener("input", () => {
    zoomLevel = parseFloat(timelineZoomSlider.value);
    updateUI();
  });

  btnAddTrack.addEventListener("click", () => {
    const seq = getActiveSequence();
    if (!seq) return;
    const kind = prompt("Enter track kind ('video' or 'audio'):", "video");
    if (kind !== "video" && kind !== "audio") {
      alert("Invalid track kind. Choose 'video' or 'audio'.");
      return;
    }
    const index = seq.tracks.length;
    const name = `${kind.charAt(0).toUpperCase()}${index + 1}`;
    dispatch("timeline.add_track", {
      sequenceId: activeSequenceId,
      track: {
        id: `track-${crypto.randomUUID().substring(0, 8)}`,
        kind,
        name,
        index,
      },
    });
  });

  btnSplitClip.addEventListener("click", handleSplitSelectedClip);
  btnDeleteClip.addEventListener("click", handleDeleteSelectedClip);

  timelineRuler.addEventListener("mousedown", (e) => {
    isDraggingPlayhead = true;
    handleTimelineSeek(e);
    window.addEventListener("mousemove", handleTimelinePlayheadDrag);
    window.addEventListener("mouseup", handleTimelinePlayheadRelease);
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target === document.body) {
      e.preventDefault();
      handlePlayPause();
    }
    if (
      (e.code === "Delete" || e.code === "Backspace") &&
      selectedClipId &&
      e.target === document.body
    ) {
      handleDeleteSelectedClip();
    }
    if (e.code === "KeyS" && selectedClipId && e.target === document.body) {
      handleSplitSelectedClip();
    }
    if (e.metaKey || e.ctrlKey) {
      if (e.code === "KeyZ") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      }
    }
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      document
        .querySelectorAll(".tab-btn")
        .forEach((b) => b.classList.remove("active"));
      document
        .querySelectorAll(".tab-content")
        .forEach((c) => c.classList.add("hidden"));

      const tabId = (e.target as HTMLElement).getAttribute("data-tab")!;
      (e.target as HTMLElement).classList.add("active");
      document.getElementById(tabId)!.classList.remove("hidden");
    });
  });

  btnImportMedia.addEventListener("click", () => {
    const directUploader = document.getElementById(
      "direct-file-uploader",
    ) as HTMLInputElement | null;
    if (directUploader) {
      directUploader.click();
    }
  });

  const directUploader = document.getElementById(
    "direct-file-uploader",
  ) as HTMLInputElement | null;
  if (directUploader) {
    directUploader.addEventListener("change", handleDirectFileUploaderChange);
  }

  btnModalClose.addEventListener("click", closeImportModal);
  btnModalCancel.addEventListener("click", closeImportModal);
  importForm.addEventListener("submit", handleImportSubmit);

  const filePicker = document.getElementById(
    "asset-file-picker",
  ) as HTMLInputElement | null;
  if (filePicker) {
    filePicker.addEventListener("change", handleFilePickerChange);
  }
}

function handleTimelinePlayheadDrag(e: MouseEvent) {
  if (isDraggingPlayhead) {
    handleTimelineSeek(e);
  }
}
function handleTimelinePlayheadRelease() {
  isDraggingPlayhead = false;
  window.removeEventListener("mousemove", handleTimelinePlayheadDrag);
  window.removeEventListener("mouseup", handleTimelinePlayheadRelease);
}

// ==========================================================================
// APP INITIALIZATION
// ==========================================================================
setupInitialProject();
bindEvents();
updateUI();
requestAnimationFrame(animate);
