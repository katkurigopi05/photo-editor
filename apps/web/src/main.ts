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
  buildSetClipBlendMode,
  buildSetClipAudioPan,
  buildSetAssetRating,
  buildSetAssetKeywords,
  buildAddKeywordRange,
  buildInsertClip,
  buildOverwriteClip,
  buildRemoveKeywordRange,
  buildSetClipSpeed,
  buildSetClipSpeedRamp,
  buildAddMarker,
  buildUpdateMarker,
  buildRemoveMarker,
  buildAddMask,
  buildUpdateMask,
  buildRemoveMask,
  buildSetEffectMask,
  buildAddKeyframe,
  buildUpdateKeyframe,
  buildRemoveKeyframe,
  buildUpdateClipAnimations,
  buildSetClipTransition,
  resolveClipDrag,
  collectSnapTargets,
  snapClipStart,
  planRippleDelete,
  planRippleTrim,
  usToPixels,
  type CommandContext,
  buildUpdateClipEffects,
  buildSetTrackMagnetic,
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
  sampleClipTransition,
  resolveAudioFades,
  audioEnvelopeGain,
  audioEnvelopeCurve,
  type PlaybackState,
  resolveAtTimeDeep,
} from "@director/playback-controller";
import {
  browserPresetUnsupportedReason,
  planExport,
  planVideoFrames,
  startExport,
  advanceExport,
  failExport,
  cancelExport,
  type ExportJob,
  type ExportPreset,
  type ExportPlan,
} from "@director/export-engine";
import {
  Muxer,
  ArrayBufferTarget,
  FileSystemWritableFileStreamTarget,
} from "mp4-muxer";
import {
  Muxer as WebmMuxer,
  ArrayBufferTarget as WebmArrayBufferTarget,
  FileSystemWritableFileStreamTarget as WebmFileStreamTarget,
} from "webm-muxer";
import {
  PRESETS,
  PRESET_LABELS,
  presetTokens,
  counterpartSeeds,
  seedsAreDark,
  deriveTheme,
  applyThemeTokens,
  loadCustomThemes,
  upsertCustomTheme,
  deleteCustomTheme,
  MAX_CUSTOM_THEMES,
  type ThemeTokens,
} from "./theme.js";
import { layoutTextLines } from "./text-overlay.js";
import { rasterizeClipMask, blendThroughMask } from "./mask-raster.js";
import type { JsonValue } from "@director/canonical-json";
import {
  describeCapabilities,
  fitWithinBudget,
  previewGradeBudgetPx,
  readEnvironment,
} from "./capabilities.js";
import {
  budgetForLevel,
  createAdaptiveState,
  describeQuality,
  isQualityPreference,
  levelForPreference,
  observeFrame,
  QUALITY_LADDER,
  type QualityPreference,
} from "./adaptive-quality.js";
import {
  ATTEMPTABLE_CODECS,
  CODEC_LABELS,
  describeCodecSupport,
  offerable,
  probeVideoCodecs,
  type AttemptableCodec,
  type CodecSupport,
} from "./codec-support.js";
import { checksumBlob } from "./checksum.js";
import {
  buildProjectFile,
  parseProjectFile,
  planRelink,
  serializeProjectFile,
  type MediaHint,
} from "./project-file.js";
import { clearSnapshot, readSnapshot, writeSnapshot } from "./autosave.js";
import {
  chromaCentre,
  clippedFraction,
  histogram,
  vectorscope,
  waveform,
} from "./scopes.js";
import {
  METER_FLOOR_DB,
  meterFraction,
  readChannel,
  silentReading,
  type ChannelReading,
} from "./audio-meter.js";
import {
  buildProxy,
  clearProxies,
  proxySize,
  proxyStoreBytes,
  readProxy,
  shouldBuildProxy,
} from "./proxy.js";
import {
  ensurePermission,
  forgetProject,
  listRecent,
  rememberProject,
} from "./recent-projects.js";
import type {
  ChecksumRequest,
  ChecksumResponse,
} from "./checksum-worker.js";
import {
  buildExportPreset,
  AUDIO_BITRATE_CHOICES,
  BITRATE_CHOICES,
  FRAME_RATE_CHOICES,
  RESOLUTION_CHOICES,
  type ExportFields,
  CODEC_CONTAINER,
  codecStringFor,
} from "./export-preset.js";
import {
  createExportSink,
  pickExportFile,
  streamingExportSupported,
} from "./export-sink.js";
import { SKINS, currentSkin, applySkin } from "./skin.js";
import {
  BLEND_MODES,
  TRANSITION_DIRECTIONS,
  TRANSITION_KINDS,
  compositeOperation,
  isAudioEffectType,
  normalizeKeyword,
  rateAtClipOffset,
  rampTimelineDurationUs,
  sourceAtClipOffset,
  type SpeedRamp,
} from "@director/project-schema";
import { detectKind, isMediaFile } from "./media-types.js";
import {
  boomerangOrder,
  clampGifFps,
  flattenPartialAlpha,
  createGifEncoder,
  isGifEncoderLoaded,
  loadGifEncoder,
} from "./gif.js";
import { RasterSession, canvasPointToImage } from "./raster.js";
import {
  clipLocalTimeUs,
  composeCanvasLayerTransform,
  resolveLayerAnimationTransform,
} from "./layer-animation.js";
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
  pencilSketch,
  oilPainting,
  cartoonPosterize,
  watercolor,
  crosshatch,
  halftone,
  whiteBalance,
  levels,
  toneCurve,
  vibrance,
  highlights as adjustHighlights,
  shadows as adjustShadows,
  whites as adjustWhites,
  blacks as adjustBlacks,
  colorMixer,
  colorGrading,
  mapPixels,
  saturation,
  luma,
  rgbToHsl,
  hslToRgb,
  boxBlurRgb,
  contrast as adjustContrast,
  exposure as adjustExposure,
  clarity,
  texture,
  dehaze,
  noiseReduction,
  type HslBand,
  type Mask,
  type Point,
  type RasterImage,
  applyCurves,
  curvePoint,
  IDENTITY_CURVE,
  type CurvePoint,
  type CurveSet,
  applyLut3d,
  cubeImageToLut,
  identityCubeImage,
} from "@director/raster-tools";
import {
  biasSubjectMask,
  bloomHighlights,
} from "./portrait-blur.js";
import {
  segmentForeground,
  configureOnnxRuntime,
  U2NETP_MODEL,
  U2NET_MODEL,
  type SegmentationModel,
} from "@director/bg-segmentation";
// Explicit, bundler-resolved asset URLs (Vite's `?url` suffix) — see
// configureOnnxRuntime's doc comment for why this can't be a runtime path.
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import ortMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import type {
  AnimationEasing,
  AnimationProperty,
  ClipMask,
  MarkerKind,
  MaskContribution,
  EffectInstance,
  EffectType,
  MediaAsset,
  Sequence,
  TimelineClip,
  Track,
  Transition,
  TransitionDirection,
  TransitionKind,
  TransitionSide,
} from "@director/project-schema";
import {
  adjacentKeyframeTime,
  animationValueAtTime,
  clipLocalTimeForPlayhead,
  exactKeyframeAtTime,
  keyframePositionPercent,
  uniqueKeyframeTimes,
} from "./keyframe-ui.js";
import {
  ANIMATION_PRESETS,
  materializeAnimationPreset,
  type AnimationPresetId,
} from "./animation-presets.js";
import {
  VECTOR_SHAPE_PRESETS,
  createVectorShapeSource,
  type VectorShapePreset,
} from "./vector-shape.js";

// ==========================================================================
// Effect catalogue — drives the inspector sliders and the preview filters.
// Ranges/defaults mirror @director/project-schema effect params.
// ==========================================================================
/** `seconds` is a range slider over a duration the model stores as a canonical
 * microsecond string — the slider is in seconds because that is what a fade is
 * spoken about in, and the conversion happens once, here, rather than in every
 * caller. */
type ParamKind = "range" | "toggle" | "color" | "text" | "seconds" | "choice";
interface ParamSpec {
  name: string;
  label: string;
  kind: ParamKind;
  min?: number;
  max?: number;
  step?: number;
  /** Options for a `choice` param, in the order they should be offered. */
  choices?: readonly string[];
  def: number | boolean | string;
}
interface EffectSpec {
  type: EffectType;
  label: string;
  modes: Array<"video" | "photo">;
  params: ParamSpec[];
  /** Defaults for an effect whose params are not a list of scalars — a curve is
   * four arrays of points, which no slider can describe. When present this is
   * the whole params object the effect is created with. */
  defaults?: Record<string, JsonValue>;
  /** Audio effects are applied by the mixer and belong to the Audio section of
   * the inspector, not to the visual effects palette. */
  surface?: "audio";
}

const range = (
  name: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
): ParamSpec => ({ name, label, kind: "range", min, max, step, def });

/** A duration slider in seconds whose stored value is a microsecond string. */
const seconds = (
  name: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: string,
): ParamSpec => ({ name, label, kind: "seconds", min, max, step, def });

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
    type: "color.white_balance",
    label: "White Balance",
    modes: ["video", "photo"],
    params: [
      range("temperature", "Warmth", -1, 1, 0.05, 0),
      range("tint", "Tint", -1, 1, 0.05, 0),
    ],
  },
  {
    type: "color.levels",
    label: "Levels",
    modes: ["video", "photo"],
    params: [
      range("blackPoint", "Blacks", 0, 1, 0.01, 0),
      range("whitePoint", "Whites", 0, 1, 0.01, 1),
      range("gamma", "Gamma", 0.1, 4, 0.05, 1),
    ],
  },
  {
    type: "color.curves",
    label: "Curves",
    modes: ["video", "photo"],
    // No slider params: a curve is edited by dragging its points, so the
    // Inspector renders a canvas for this type instead of a parameter list.
    params: [],
    // All four channels start as the diagonal, which is the identity — an
    // absent curve and an identity curve would render the same and store
    // differently, so the schema requires all four to be present.
    defaults: {
      rgb: IDENTITY_CURVE.map((p) => ({ x: p.x, y: p.y })),
      red: IDENTITY_CURVE.map((p) => ({ x: p.x, y: p.y })),
      green: IDENTITY_CURVE.map((p) => ({ x: p.x, y: p.y })),
      blue: IDENTITY_CURVE.map((p) => ({ x: p.x, y: p.y })),
    },
  },
  {
    type: "color.tone_curve",
    label: "Tone Curve",
    modes: ["video", "photo"],
    params: [
      range("shadows", "Shadows", -1, 1, 0.05, 0),
      range("midtones", "Midtones", -1, 1, 0.05, 0),
      range("highlights", "Highlights", -1, 1, 0.05, 0),
    ],
  },
  {
    type: "color.vibrance",
    label: "Vibrance",
    modes: ["video", "photo"],
    params: [range("amount", "Amount", -1, 1, 0.05, 0)],
  },
  {
    type: "light.tone",
    label: "Tone (Light)",
    modes: ["video", "photo"],
    params: [
      range("highlights", "Highlights", -100, 100, 1, 0),
      range("shadows", "Shadows", -100, 100, 1, 0),
      range("whites", "Whites", -100, 100, 1, 0),
      range("blacks", "Blacks", -100, 100, 1, 0),
    ],
  },
  {
    // One band per instance: eight bands at three sliders each would be
    // twenty-four controls on one effect, so the stack carries one instance
    // per band the photograph actually needs.
    type: "color.hsl_mixer",
    label: "Colour Mixer (HSL)",
    modes: ["video", "photo"],
    params: [
      {
        name: "band",
        label: "Band",
        kind: "choice",
        choices: [
          "red",
          "orange",
          "yellow",
          "green",
          "aqua",
          "blue",
          "purple",
          "magenta",
        ],
        def: "red",
      },
      range("hue", "Hue", -100, 100, 1, 0),
      range("saturation", "Saturation", -100, 100, 1, 0),
      range("luminance", "Luminance", -100, 100, 1, 0),
    ],
  },
  {
    type: "color.color_grading",
    label: "Colour Grading",
    modes: ["video", "photo"],
    params: [
      range("shadowsHue", "Shadow hue", 0, 360, 1, 220),
      range("shadowsStrength", "Shadow strength", 0, 100, 1, 0),
      range("midtonesHue", "Midtone hue", 0, 360, 1, 120),
      range("midtonesStrength", "Midtone strength", 0, 100, 1, 0),
      range("highlightsHue", "Highlight hue", 0, 360, 1, 40),
      range("highlightsStrength", "Highlight strength", 0, 100, 1, 0),
      range("balance", "Balance", -100, 100, 1, 0),
      range("blend", "Blend", 0, 100, 1, 100),
    ],
  },
  {
    type: "fx.presence",
    label: "Presence",
    modes: ["video", "photo"],
    params: [
      range("clarity", "Clarity", -100, 100, 1, 0),
      range("texture", "Texture", -100, 100, 1, 0),
      range("dehaze", "Dehaze", -100, 100, 1, 0),
    ],
  },
  {
    type: "detail.noise_reduction",
    label: "Noise Reduction",
    modes: ["video", "photo"],
    params: [
      range("luminance", "Luminance", 0, 100, 1, 0),
      range("color", "Colour", 0, 100, 1, 0),
    ],
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
    type: "art.pencil_sketch",
    label: "Pencil Sketch",
    modes: ["photo", "video"],
    params: [
      range("strength", "Strength", 0, 1, 0.05, 1),
      range("grain", "Paper grain", 0, 1, 0.05, 0.25),
    ],
  },
  {
    type: "art.oil_painting",
    label: "Oil Painting",
    modes: ["photo", "video"],
    params: [range("radiusPx", "Brush", 1, 8, 1, 4)],
  },
  {
    type: "art.cartoon",
    label: "Cartoon",
    modes: ["photo", "video"],
    params: [
      range("levels", "Colours", 2, 16, 1, 5),
      range("edgeStrength", "Ink", 0, 1, 0.05, 0.8),
    ],
  },
  {
    type: "art.watercolor",
    label: "Watercolour",
    modes: ["photo", "video"],
    params: [
      range("poolRadiusPx", "Pooling", 1, 8, 1, 3),
      range("edgeStrength", "Dried edge", 0, 1, 0.05, 0.7),
      range("grain", "Paper", 0, 1, 0.05, 0.3),
    ],
  },
  {
    type: "art.crosshatch",
    label: "Crosshatch",
    modes: ["photo", "video"],
    params: [
      range("spacingPx", "Line spacing", 2, 24, 1, 5),
      range("darkness", "Ink", 0, 1, 0.05, 1),
    ],
  },
  {
    type: "art.halftone",
    label: "Halftone",
    modes: ["photo", "video"],
    params: [
      range("cellPx", "Dot size", 2, 24, 1, 6),
      range("angleDegrees", "Screen angle", 0, 90, 5, 45),
    ],
  },
  {
    type: "fx.text",
    label: "Text",
    modes: ["photo", "video"],
    params: [
      { name: "text", label: "Caption", kind: "text", def: "" },
      range("fontSizeRatio", "Size", 0.02, 0.3, 0.005, 0.08),
      { name: "colorHex", label: "Fill", kind: "color", def: "#ffffff" },
      { name: "outlineHex", label: "Outline", kind: "color", def: "#000000" },
      range("x", "Across", 0, 1, 0.01, 0.5),
      range("y", "Down", 0, 1, 0.01, 0.85),
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
  {
    type: "audio.fade",
    label: "Fade In / Out",
    modes: ["video", "photo"],
    surface: "audio",
    params: [
      seconds("fadeInUs", "Fade in (s)", 0, 10, 0.1, "0"),
      seconds("fadeOutUs", "Fade out (s)", 0, 10, 0.1, "0"),
    ],
  },
  {
    type: "audio.eq",
    label: "EQ",
    modes: ["video", "photo"],
    surface: "audio",
    params: [
      range("lowGainDb", "Low (dB)", -24, 24, 0.5, 0),
      range("midGainDb", "Mid (dB)", -24, 24, 0.5, 0),
      range("highGainDb", "High (dB)", -24, 24, 0.5, 0),
    ],
  },
  {
    type: "audio.compressor",
    label: "Compressor",
    modes: ["video", "photo"],
    surface: "audio",
    params: [
      range("thresholdDb", "Threshold (dB)", -60, 0, 1, -24),
      range("ratio", "Ratio", 1, 20, 0.5, 4),
      range("attackMs", "Attack (ms)", 0, 1000, 1, 10),
      range("releaseMs", "Release (ms)", 0, 1000, 5, 250),
      range("makeupGainDb", "Makeup (dB)", -24, 24, 0.5, 0),
    ],
  },
];

const effectSpec = (type: string): EffectSpec | undefined =>
  EFFECTS.find((e) => e.type === type);

/** Visual effects, i.e. everything the palette and the renderer deal with. */
const visualEffects = (): EffectSpec[] =>
  EFFECTS.filter((spec) => spec.surface !== "audio");

const audioEffects = (): EffectSpec[] =>
  EFFECTS.filter((spec) => spec.surface === "audio");

function defaultParams(spec: EffectSpec): Record<string, JsonValue> {
  // A spec with non-scalar params supplies the whole object: building it from
  // an empty `params` list would produce `{}`, which the effect's own schema
  // rejects — the effect would simply never be added, with no visible reason.
  if (spec.defaults) return structuredClone(spec.defaults);
  const out: Record<string, JsonValue> = {};
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
/** GIF is a third output mode, not a third editor: it shares the timeline and
 * the effect stack with video, and differs only in how frames leave the app. */
type EditorMode = "video" | "photo" | "animation" | "gif";
const MODE_ORDER: readonly EditorMode[] = [
  "photo",
  "video",
  "animation",
  "gif",
];
/** Wheel geometry and gesture thresholds — see the .mode-wheel CSS block. */
const MODE_WHEEL_STEP_DEG = 60;
const MODE_WHEEL_SCROLL_PX = 40;
const MODE_WHEEL_DRAG_PX = 22;
let mode: EditorMode = "photo";
let selectedClipId: string | null = null;
/** Extra clips picked with Shift/Cmd-click. `selectedClipId` stays the clip the
 * Inspector is editing; these are the others the next timeline action covers. */
const selectedClipIds = new Set<string>();
/** Media-bin culling state. Neither is project state: they decide what the bin
 * shows, not what the project contains, so they never enter the command log. */
let mediaSearch = "";
type MediaFilter = "all" | "favorites" | "rejected" | "unrated";
let mediaFilter: MediaFilter = "all";
/** Read once: the environment does not change while the app is open, and
 * re-reading it per frame would be a syscall in the render loop. */
const ENVIRONMENT = readEnvironment();
/** The video codec the export dialog is set to. Session state: it describes
 * the next export, not the project. */
let exportCodec: AttemptableCodec = "h264";
let codecSupport: CodecSupport[] = [];

const QUALITY_PREF_KEY = "director-preview-quality";

/** What the user asked for. Machine-personal like the theme and saved views, so
 * it lives in localStorage rather than in the project. */
let qualityPreference: QualityPreference = ((): QualityPreference => {
  const stored = localStorage.getItem(QUALITY_PREF_KEY);
  return isQualityPreference(stored) ? stored : "auto";
})();

/**
 * Auto-scaling state.
 *
 * The device's own report picks the opening rung — the nearest to what its
 * cores suggest — and measurement takes over from there. A guess makes a better
 * first frame than the middle of the ladder; it makes a far worse tenth frame
 * than a measurement does.
 */
let adaptiveQuality = createAdaptiveState(
  ((): number => {
    const hint = previewGradeBudgetPx(ENVIRONMENT);
    let best = 0;
    QUALITY_LADDER.forEach((px, index) => {
      if (Math.abs(px - hint) < Math.abs(QUALITY_LADDER[best]! - hint)) {
        best = index;
      }
    });
    return best;
  })(),
);

/** Set by the adjustment-layer path when it actually did pixel work, so only
 * frames that exercised the budget are used to judge it — a frame with nothing
 * to grade is fast for reasons that say nothing about the machine. */
let gradedThisFrame = false;

/** The pixel budget in force for preview grading right now. */
function previewBudget(): number {
  const pinned = levelForPreference(qualityPreference);
  return budgetForLevel(pinned ?? adaptiveQuality.level);
}

let mediaKeyword = "";

/**
 * Where an add from the bin lands, and what happens to what is already there —
 * the destination half of three-point editing.
 *
 * Session state, not project state: it is a way of working, not a fact about
 * the edit. Nothing about it changes what would be rendered, and the commands
 * it chooses between record what actually happened.
 */
let editMode: "append" | "insert" | "overwrite" = "append";

/**
 * Saved views: a named search + keyword + rating filter.
 *
 * Final Cut's Smart Collections in miniature, and deliberately *not* project
 * state — a saved view describes how someone likes to look at a bin, not
 * anything about the media. It lives in localStorage so it survives a reload
 * without entering the operation log or the project file.
 */
interface SavedView {
  name: string;
  search: string;
  keyword: string;
  filter: MediaFilter;
}
const SAVED_VIEWS_KEY = "director.media.views";

/**
 * In/out points chosen in the bin, per asset.
 *
 * Final Cut calls this the browser range: you decide which part of a shot you
 * want *before* it reaches the timeline, instead of adding the whole thing and
 * trimming it back. Session state, not project state — the range is an
 * intention about the next edit, and once a clip exists its own in/out points
 * are the record. Keeping it out of the project also keeps the media bin from
 * having opinions that survive a reload.
 */
interface BrowserRange {
  inUs: string;
  outUs: string;
}
const browserRanges = new Map<string, BrowserRange>();

/**
 * Where an asset's bytes actually are, this session.
 *
 * A saved project carries the operation log, and the log carries each asset's
 * `blob:` URL — which died with the tab that made it. Relinking points the app
 * at the file the user picked instead, and it lives here rather than in the
 * project because a relink is not an edit: the same project opened tomorrow
 * with the same files must produce the same operation log, not one with a
 * session's worth of relink commands appended.
 */
const relinkedUris = new Map<string, string>();

/** The URI to load an asset's media from. */
function assetUri(asset: MediaAsset): string {
  return relinkedUris.get(asset.id) ?? asset.originalUri;
}

/**
 * Proxy copies, by asset id.
 *
 * Like a relink, a proxy is a fact about this session and not about the
 * project: the same edit against the same footage must produce the same
 * operation log whether or not a small copy happened to exist. The map holds
 * object URLs into `mediaCache`, so every render site reaches a proxy the same
 * way it reaches an original.
 */
const proxyUris = new Map<string, string>();

/** Proxies still being built, by asset id, as a 0..1 fraction. */
const proxyBuilding = new Map<string, number>();

const PROXY_PREF_KEY = "director.useProxies";

/** Whether editing reads proxies. Exports never do — see `renderOriginals`. */
let useProxies = localStorage.getItem(PROXY_PREF_KEY) !== "off";

/**
 * Set while an export is rendering.
 *
 * `drawLayer` is shared by the preview and by both export paths, so the choice
 * of which copy to read cannot live at the call site — it is a property of what
 * the render is *for*. Editing reads proxies; anything that produces a file the
 * user keeps reads the originals.
 */
let renderOriginals = false;

/** The media element a render should read for this asset. */
function mediaFor(
  asset: MediaAsset,
): HTMLImageElement | HTMLVideoElement | undefined {
  const original = mediaCache.get(assetUri(asset));
  if (renderOriginals || !useProxies) return original;
  // During playback the original element is the one being driven — it is what
  // carries the sound — so the picture comes from it too. Proxies earn their
  // keep on the other path: scrubbing, where every move costs a decode.
  if (playback.playing) return original;
  const proxy = proxyUris.get(asset.id);
  const proxyMedia = proxy ? mediaCache.get(proxy) : undefined;
  return proxyMedia ?? original;
}

/**
 * Proxy builds run one at a time.
 *
 * Each build holds an encoder and seeks a video element as fast as it can;
 * three at once is three times the work and three times slower per file, with
 * a preview that stutters throughout. Importing a folder queues them instead.
 */
let proxyQueue: Promise<void> = Promise.resolve();

/**
 * Set while an export is running, and read by proxy builds.
 *
 * Both work the same way — seek a video element, draw, encode — and run against
 * the same file. Doing them at once starves the export's seeks, so it draws the
 * frame it already had: an export made during a proxy build came out as one
 * picture repeated. Building pauses instead, and resumes when the export is
 * done. Every editor that has both features makes the same trade.
 */
let exportActive = false;

/** How long a source is given to report its dimensions before the build gives
 * up on it. Long enough for a large file off a slow disk, short enough that an
 * unreadable one does not hold the queue. */
const PROXY_METADATA_TIMEOUT_MS = 15_000;

/** Proxy builds still owed, by asset id, so a paused one can be picked up. */
const proxyRequests = new Map<
  string,
  { checksum: string; url: string; durationUs: string; name: string }
>();

/** Start any proxy build that was paused for an export. */
function resumeProxies(): void {
  for (const [assetId, request] of proxyRequests) {
    if (proxyUris.has(assetId)) continue;
    ensureProxy(assetId, request.checksum, request.url, request.durationUs, request.name);
  }
}

/**
 * Make sure this asset has a proxy, building one if it is worth it.
 *
 * Never throws and never blocks the import: a proxy is an optimisation, so a
 * browser without WebCodecs, a codec the encoder refuses, or a full disk all
 * end the same way — editing against the original, exactly as before.
 */
function ensureProxy(
  assetId: string,
  checksum: string,
  url: string,
  durationUs: string,
  name: string,
): void {
  proxyRequests.set(assetId, { checksum, url, durationUs, name });
  proxyQueue = proxyQueue.then(async () => {
    if (proxyUris.has(assetId) || exportActive) return;
    const existing = await readProxy(checksum);
    if (existing) {
      attachProxy(assetId, existing);
      renderMedia();
      return;
    }
    // A private element, not the one in the media cache. Transcoding seeks its
    // source thousands of times, and the cached element is simultaneously the
    // preview's and the export's — sharing it means each one's seeks land in
    // the other's frames. That is not theoretical: it turned an export of a
    // freshly-imported clip into repeated frames.
    const source = document.createElement("video");
    source.src = url;
    source.muted = true;
    source.preload = "auto";
    const ready = await new Promise<boolean>((resolve) => {
      source.onloadedmetadata = () => resolve(true);
      source.onerror = () => resolve(false);
      // Neither event is promised. A file the browser cannot probe at all just
      // never answers, and since builds are queued one at a time, waiting on it
      // forever would cost every proxy behind it too.
      setTimeout(() => resolve(false), PROXY_METADATA_TIMEOUT_MS);
    });
    if (!ready) {
      source.removeAttribute("src");
      source.load();
      return;
    }

    proxyBuilding.set(assetId, 0);
    renderMedia();
    const file = await buildProxy(source, {
      checksum,
      durationUs,
      onProgress: (fraction) => {
        proxyBuilding.set(assetId, fraction);
        updateProxyStatus();
      },
      cancelled: () => exportActive,
    });
    proxyBuilding.delete(assetId);
    const size = proxySize(source.videoWidth, source.videoHeight);
    source.removeAttribute("src");
    source.load();
    if (file) {
      proxyRequests.delete(assetId);
      attachProxy(assetId, file);
      toast(`Proxy ready for ${name} (${size.width}x${size.height}).`);
    }
    renderMedia();
    updateProxyStatus();
  });
}

/** Load a built proxy into the media cache the renderer reads from. */
function attachProxy(assetId: string, file: File): void {
  const url = URL.createObjectURL(file);
  const element = document.createElement("video");
  element.src = url;
  element.muted = true;
  element.preload = "auto";
  element.addEventListener("loadedmetadata", () => updateUI(), { once: true });
  attachOffscreen(element);
  mediaCache.set(url, element);
  proxyUris.set(assetId, url);
}

/** The one-line summary beside the proxy toggle. */
function updateProxyStatus(): void {
  const status = $("proxy-status");
  const clear = $<HTMLButtonElement>("btn-clear-proxies");
  const building = [...proxyBuilding.values()];
  if (building.length > 0) {
    const percent = Math.round((building[0] ?? 0) * 100);
    status.textContent =
      building.length === 1
        ? `Building proxy — ${percent}%`
        : `Building proxy — ${percent}% (${building.length - 1} queued)`;
    clear.classList.add("hidden");
    return;
  }
  const count = proxyUris.size;
  clear.classList.toggle("hidden", count === 0);
  if (count === 0) {
    status.textContent = "";
    return;
  }
  status.textContent = `${count} prox${count === 1 ? "y" : "ies"}`;
  // The size comes from disk rather than from what this session built, so a
  // store left behind by earlier sessions is counted too.
  void proxyStoreBytes().then((bytes) => {
    if (proxyBuilding.size > 0 || proxyUris.size === 0) return;
    status.textContent = `${count} prox${count === 1 ? "y" : "ies"} · ${formatBytes(bytes)}`;
  });
}

/** Delete every proxy file and go back to editing the originals. */
async function discardProxies(): Promise<void> {
  for (const url of proxyUris.values()) {
    mediaCache.delete(url);
    URL.revokeObjectURL(url);
  }
  proxyUris.clear();
  await clearProxies();
  renderMedia();
  updateProxyStatus();
  updateUI();
  toast("Proxies deleted — editing the originals.");
}

/**
 * Assets whose bytes are not available in this session.
 *
 * An adjustment layer has no bytes by definition, so it is never "missing" and
 * can never be relinked. Without this it would sit in the bin under a Relink
 * prompt and keep the "1 file missing" bar up for the life of the project.
 */
function offlineAssets(): MediaAsset[] {
  return (session.getProject()?.assets ?? []).filter(
    (asset) =>
      !removedAssets.has(asset.id) &&
      asset.kind !== "adjustment" &&
      // A compound clip's asset names a sequence, not a file: there is nothing
      // to find and nothing to relink, so it is never "missing".
      asset.kind !== "sequence" &&
      !mediaCache.has(assetUri(asset)),
  );
}

/** The source window an asset should be added with: its range, or all of it. */
function rangeFor(asset: MediaAsset): BrowserRange {
  const full = { inUs: "0", outUs: asset.metadata.durationUs ?? "5000000" };
  const chosen = browserRanges.get(asset.id);
  if (!chosen) return full;
  // A range outlives nothing: if it somehow exceeds the asset it is ignored
  // rather than handed to the reducer to refuse.
  if (BigInt(chosen.outUs) > BigInt(full.outUs)) return full;
  return chosen;
}

function loadSavedViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(SAVED_VIEWS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SavedView[]) : [];
  } catch {
    // Corrupt or unavailable storage is not a reason to break the bin.
    return [];
  }
}

function storeSavedViews(views: SavedView[]): void {
  try {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
  } catch {
    toast("Could not save the view — browser storage is unavailable.", true);
  }
}
let zoom = 120; // pixels per second
let playback: PlaybackState = createPlaybackState("0");

interface AnimationControlSpec {
  property: AnimationProperty;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
}

const ANIMATION_CONTROLS: readonly AnimationControlSpec[] = [
  {
    property: "transform.position_x",
    label: "Position X",
    min: -2,
    max: 2,
    step: 0.01,
    format: (value) => `${Math.round(value * 100)}%`,
  },
  {
    property: "transform.position_y",
    label: "Position Y",
    min: -2,
    max: 2,
    step: 0.01,
    format: (value) => `${Math.round(value * 100)}%`,
  },
  {
    property: "transform.scale",
    label: "Scale",
    min: 0.1,
    max: 4,
    step: 0.01,
    format: (value) => `${value.toFixed(2)}×`,
  },
  {
    property: "transform.rotation",
    label: "Rotation",
    min: -360,
    max: 360,
    step: 1,
    format: (value) => `${Math.round(value)}°`,
  },
  {
    property: "transform.opacity",
    label: "Opacity",
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => `${Math.round(value * 100)}%`,
  },
];

const ANIMATION_EASINGS: readonly AnimationEasing[] = [
  "linear",
  "hold",
  "ease-in",
  "ease-out",
  "ease-in-out",
];
const mediaCache = new Map<string, HTMLImageElement | HTMLVideoElement>();
// Display-only friendly names per asset id (original filename at import, or a
// generated label for edited exports). Not part of the deterministic project.
const assetNames = new Map<string, string>();
// Asset ids hidden from the media bin (there's no public asset-removal
// command; this is a display filter, like mediaCache/assetNames).
const removedAssets = new Set<string>();

// -- Live audio monitoring (preview A/V sync; Phase 3 sync + Phase 4 mixing).
// Session state, outside the command engine — like playback itself. Each
// media element is routed once through gain→pan→destination so the timeline
// is actually audible while playing, with each clip's gain/pan applied. --
let audioCtx: AudioContext | null = null;
/**
 * One fixed chain per media element: EQ shelves and peak, then a compressor,
 * then gain and pan.
 *
 * The nodes always exist and sit at neutral settings when the clip carries no
 * audio effects. `createMediaElementSource` may only run once per element, so
 * rebuilding the graph whenever an effect is added or removed is not an option
 * — the alternative to a fixed chain is a graph that cannot be edited.
 */
interface AudioRoute {
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  gain: GainNode;
  pan: StereoPannerNode;
}

/** Band corners shared by live monitoring and the export mixdown. */
const EQ_LOW_HZ = 250;
const EQ_MID_HZ = 1000;
const EQ_MID_Q = 0.8;
const EQ_HIGH_HZ = 4000;
const audioRoutes = new Map<HTMLMediaElement, AudioRoute>();

// Cached normalized waveform peaks (0..1) per audio asset id, for the
// timeline. Decoded once, asynchronously, then the timeline re-renders.
const WAVEFORM_BUCKETS = 1400;
const waveformCache = new Map<string, number[]>();
const waveformPending = new Set<string>();
let decodeCtx: OfflineAudioContext | null = null;

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
  | "bgremove"
  | "aibgremove";
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
  aiModel: "fast" as "fast" | "accurate",
};

let aiSegmentationBusy = false;
// While true (Before/After button held), the preview shows the raw original.
let compareShowOriginal = false;

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
const mediaEmptyEl = $<HTMLParagraphElement>("media-empty");
let galleryGrid = false; // media bin: grid (gallery) vs list view
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
const looksRow = $<HTMLDivElement>("looks-row");
const vectorShapesEl = $<HTMLDivElement>("vector-shapes");

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
  // Every accepted command is unsaved work until the next snapshot or save.
  projectDirty = true;
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

// Module-level (not scoped to bindEvents) so any drop target — the window-
// level fallback, the stage, or a timeline lane, each in a different
// function's closure — can force the overlay closed. A target that calls
// stopPropagation() on its own "drop" (to avoid double-importing the same
// files) opts out of the window-level "drop" listener too, so it must clean
// the overlay up itself or it gets stuck visible forever.
let dropOverlayDepth = 0;
function hideDropOverlay(): void {
  dropOverlayDepth = 0;
  $<HTMLDivElement>("drop-overlay").classList.add("hidden");
}

function formatTime(us: string | number): string {
  const totalMs = Math.round(Number(us) / 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/** A file size a person can read at a glance. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * The hashing worker, created on first use and kept for the session.
 *
 * A worker per import would pay its startup cost on every file of a batch;
 * one worker, addressed by request id, handles them in turn.
 */
let checksumWorker: Worker | null = null;
let checksumRequestCounter = 0;

function ensureChecksumWorker(): Worker | null {
  if (checksumWorker) return checksumWorker;
  try {
    // The `.ts` specifier is the bundler's form: Vite rewrites it to the built
    // worker chunk. Pointing at `.js` resolves to nothing in dev, and the
    // failure arrives as an async error event rather than a throw — which is
    // how a missing worker turned into an import that hung forever.
    checksumWorker = new Worker(
      new URL("./checksum-worker.ts", import.meta.url),
      { type: "module" },
    );
  } catch {
    // No worker (older browser, blocked context): hashing still happens, just
    // on this thread. Slower and less responsive, never wrong.
    checksumWorker = null;
  }
  return checksumWorker;
}

/**
 * SHA-256 of a file, streamed.
 *
 * Previously `file.arrayBuffer()` read the whole file to hash it, so importing
 * anything past the browser's ArrayBuffer ceiling failed outright and smaller
 * files still spiked memory by their full size. The bytes now flow through the
 * hasher a chunk at a time, in a worker, with progress for the files big enough
 * that the wait is noticeable.
 */
async function checksumFile(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const worker = ensureChecksumWorker();
  if (!worker) return checksumBlob(file, (done, total) =>
    onProgress?.(total > 0 ? done / total : 1),
  );

  const id = `checksum-${(checksumRequestCounter += 1)}`;
  return new Promise<string>((resolve, reject) => {
    const onMessage = (event: MessageEvent<ChecksumResponse>): void => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === "progress") {
        onProgress?.(
          message.total > 0 ? message.bytesHashed / message.total : 1,
        );
        return;
      }
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      if (message.type === "done") resolve(message.checksum);
      else reject(new Error(message.message));
    };
    // A worker that dies mid-request would otherwise leave this promise
    // pending and the import silently stuck.
    const onError = (): void => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      checksumWorker = null;
      void checksumBlob(file, (done, total) =>
        onProgress?.(total > 0 ? done / total : 1),
      ).then(resolve, reject);
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ id, file } satisfies ChecksumRequest);
  });
}

function activeSequence(): Sequence | undefined {
  return session.getProject()?.sequences.find((s) => s.id === SEQUENCE_ID);
}

function findAsset(id: string): MediaAsset | undefined {
  return session.getProject()?.assets.find((a) => a.id === id);
}

/**
 * The four curves an effect carries, each falling back to the identity curve.
 *
 * Read defensively rather than trusted: the params are validated on the way
 * into state, but this also runs against effects being edited live and against
 * anything an older project happens to hold.
 */
/** Which of a curve effect's four channels the editor is showing. Session
 * state: it is a way of looking at the effect, not part of it. */
const curveChannel = new Map<string, keyof CurveSet>();

/** How close a click must be to grab an existing point, in canvas pixels. */
const CURVE_GRAB_PX = 10;

/**
 * The curve editor: a square, the curve, and its points.
 *
 * Drag a point to move it, click empty space to add one, double-click or
 * right-click a point to remove it. The two endpoints can move vertically but
 * not horizontally — the schema anchors them at x = 0 and x = 1 so the curve is
 * defined across the whole range, and letting them slide inward would leave the
 * ends undefined.
 *
 * Committed on release rather than on every pointer move: a drag is one edit,
 * and one command per mouse sample would bury the operation log and make Undo
 * step back through a gesture pixel by pixel.
 */
function curveEditor(clip: TimelineClip, fx: EffectInstance): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "curve-editor";

  const channel = curveChannel.get(fx.id) ?? "rgb";
  const tabs = document.createElement("div");
  tabs.className = "curve-tabs";
  const CHANNELS: Array<[keyof CurveSet, string]> = [
    ["rgb", "RGB"],
    ["red", "R"],
    ["green", "G"],
    ["blue", "B"],
  ];
  for (const [key, label] of CHANNELS) {
    const tab = document.createElement("button");
    tab.className = `mini curve-tab curve-tab-${key}`;
    tab.textContent = label;
    tab.setAttribute("aria-pressed", String(key === channel));
    tab.setAttribute("aria-label", `${label} curve`);
    tab.addEventListener("click", () => {
      curveChannel.set(fx.id, key);
      renderInspector();
    });
    tabs.appendChild(tab);
  }
  wrap.appendChild(tabs);

  const size = 220;
  const canvas = document.createElement("canvas");
  canvas.className = "curve-canvas";
  canvas.width = size;
  canvas.height = size;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", `${channel} curve editor`);
  wrap.appendChild(canvas);

  const set = curveSetOf(fx);
  let points = [...set[channel]].map((p) => ({ ...p }));

  const toCanvas = (p: CurvePoint) => ({
    x: p.x * size,
    y: (1 - p.y) * size,
  });

  const draw = (): void => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const styles = getComputedStyle(document.documentElement);
    const line = styles.getPropertyValue("--line").trim() || "#8884";
    const accent = styles.getPropertyValue("--accent").trim() || "#7c5cff";
    const text = styles.getPropertyValue("--text").trim() || "#eee";

    ctx.clearRect(0, 0, size, size);
    // A quarter grid: enough to judge where a point sits, few enough not to
    // compete with the curve.
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const at = (i / 4) * size;
      ctx.beginPath();
      ctx.moveTo(at, 0);
      ctx.lineTo(at, size);
      ctx.moveTo(0, at);
      ctx.lineTo(size, at);
      ctx.stroke();
    }
    // The identity, so a change is visible as a departure from it.
    ctx.strokeStyle = line;
    ctx.beginPath();
    ctx.moveTo(0, size);
    ctx.lineTo(size, 0);
    ctx.stroke();

    ctx.strokeStyle = channel === "rgb" ? text : accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let px = 0; px <= size; px += 1) {
      const y = (1 - curvePoint(points, px / size)) * size;
      if (px === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.stroke();

    ctx.fillStyle = accent;
    for (const p of points) {
      const c = toCanvas(p);
      ctx.beginPath();
      ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const commitPoints = (): void => {
    commit(
      buildUpdateEffectParams(nextCtx(), {
        sequenceId: SEQUENCE_ID,
        clipId: clip.id,
        effectId: fx.id,
        // The params object is JSON by construction — the curve is an array of
        // {x, y} numbers — so this narrows rather than widens.
        params: {
          ...(fx.params as Record<string, JsonValue>),
          [channel]: points.map((p) => ({ x: p.x, y: p.y })),
        },
      }),
    );
  };

  const positionOf = (event: PointerEvent | MouseEvent): CurvePoint => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height)),
    };
  };

  const nearestIndex = (at: CurvePoint): number => {
    const rect = canvas.getBoundingClientRect();
    let best = -1;
    let bestDistance = Infinity;
    points.forEach((p, index) => {
      const dx = (p.x - at.x) * rect.width;
      const dy = (p.y - at.y) * rect.height;
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return bestDistance <= CURVE_GRAB_PX ? best : -1;
  };

  let dragging = -1;
  canvas.addEventListener("pointerdown", (event) => {
    const at = positionOf(event);
    let index = nearestIndex(at);
    if (index === -1) {
      // A click in open space adds a point there, which is how a curve is
      // shaped without a separate "add" mode.
      const insertAt = points.findIndex((p) => p.x > at.x);
      index = insertAt === -1 ? points.length : insertAt;
      points.splice(index, 0, at);
    }
    dragging = index;
    canvas.setPointerCapture(event.pointerId);
    draw();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (dragging < 0) return;
    const at = positionOf(event);
    const isEnd = dragging === 0 || dragging === points.length - 1;
    const previous = points[dragging - 1];
    const next = points[dragging + 1];
    // Endpoints keep their x so the curve stays anchored across the range;
    // inner points are held strictly between their neighbours, because two
    // points sharing an x is a curve with no defined value there.
    const EPSILON = 0.001;
    const x = isEnd
      ? points[dragging]!.x
      : Math.max(
          (previous?.x ?? 0) + EPSILON,
          Math.min((next?.x ?? 1) - EPSILON, at.x),
        );
    points[dragging] = { x, y: at.y };
    draw();
  });

  const endDrag = (): void => {
    if (dragging < 0) return;
    dragging = -1;
    commitPoints();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  const removeAt = (event: MouseEvent): void => {
    event.preventDefault();
    const index = nearestIndex(positionOf(event));
    // The endpoints are structural: removing one would leave the curve
    // undefined at that end, which the schema refuses anyway.
    if (index <= 0 || index >= points.length - 1) return;
    points.splice(index, 1);
    draw();
    commitPoints();
  };
  canvas.addEventListener("dblclick", removeAt);
  canvas.addEventListener("contextmenu", removeAt);

  const reset = document.createElement("button");
  reset.className = "mini";
  reset.textContent = "Reset channel";
  reset.addEventListener("click", () => {
    points = [...IDENTITY_CURVE].map((p) => ({ ...p }));
    draw();
    commitPoints();
  });
  wrap.appendChild(reset);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "Drag to shape, click to add a point, double-click one to remove it. The " +
    "two ends move up and down only.";
  wrap.appendChild(hint);

  draw();
  return wrap;
}

function curveSetOf(effect: EffectInstance): CurveSet {
  const params = effect.params as Record<string, unknown>;
  const read = (name: string): CurvePoint[] => {
    const raw = params[name];
    if (!Array.isArray(raw) || raw.length < 2) return [...IDENTITY_CURVE];
    const points = raw.filter(
      (p): p is CurvePoint =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as CurvePoint).x === "number" &&
        typeof (p as CurvePoint).y === "number",
    );
    return points.length >= 2 ? points : [...IDENTITY_CURVE];
  };
  return {
    rgb: read("rgb"),
    red: read("red"),
    green: read("green"),
    blue: read("blue"),
  };
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

/**
 * Find a clip in *any* sequence, not only the one being edited.
 *
 * Deep resolution returns clips from inside compound clips, and those live in
 * another sequence — so looking them up with `locateClip` finds nothing and the
 * renderer silently draws a black frame. That is exactly what happened: the
 * compound clip was correct in state, the resolver returned its contents, and
 * the draw loop dropped every one of them on the floor.
 *
 * Only the render paths use this. Selection and the inspector deliberately keep
 * to `locateClip`, because a clip you cannot see on this timeline is not one
 * you can select or edit here.
 */
function locateClipAnywhere(clipId: string | null): ClipLocation | null {
  const here = locateClip(clipId);
  if (here || !clipId) return here;
  for (const sequence of session.getProject()?.sequences ?? []) {
    for (const track of sequence.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return { clip, track };
    }
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
  const kind = detectKind(file);

  let width = 1920;
  let height = 1080;
  let durationUs = "5000000"; // default 5s for images

  if (kind === "image") {
    const img = new Image();
    img.src = url;
    const decoded = await img
      .decode()
      .then(() => true)
      .catch(() => false);
    // Registering an undecodable file would put a permanently blank clip on
    // the timeline and silently export black frames — say so instead.
    if (!decoded || !img.naturalWidth) {
      URL.revokeObjectURL(url);
      toast(`Could not decode ${file.name} — unsupported image format.`, true);
      return;
    }
    width = img.naturalWidth;
    height = img.naturalHeight;
    mediaCache.set(url, img);
  } else {
    const el = document.createElement(kind === "video" ? "video" : "audio") as
      | HTMLVideoElement
      | HTMLAudioElement;
    el.src = url;
    el.muted = true;
    // Video needs actual frame data to paint the first preview, not just the
    // metadata header; audio only ever needs the duration up front.
    el.preload = kind === "video" ? "auto" : "metadata";
    const loaded = await new Promise<boolean>((resolve) => {
      el.onloadedmetadata = () => resolve(true);
      el.onerror = () => resolve(false);
    });
    if (!loaded) {
      URL.revokeObjectURL(url);
      toast(
        `Could not decode ${file.name} — this browser cannot play that ${kind} format.`,
        true,
      );
      return;
    }
    // Streams written without a duration header report Infinity; the clip
    // still works, it just cannot be sized from metadata.
    const seconds = Number.isFinite(el.duration) && el.duration > 0
      ? el.duration
      : 5;
    durationUs = String(Math.max(1, Math.round(seconds * 1_000_000)));
    if (el instanceof HTMLVideoElement) {
      width = el.videoWidth || width;
      height = el.videoHeight || height;
      attachOffscreen(el);
    }
    mediaCache.set(url, el as HTMLVideoElement);
  }

  // Large files take long enough that silence reads as a hang; the toast
  // carries the progress rather than a spinner that says nothing.
  const LOUD_ENOUGH_BYTES = 64 * 1024 * 1024;
  const announce = file.size >= LOUD_ENOUGH_BYTES;
  if (announce) {
    toast(`Reading ${file.name} (${formatBytes(file.size)})…`);
  }
  const checksum = await checksumFile(file, (fraction) => {
    if (!announce) return;
    toast(
      `Reading ${file.name} — ${Math.round(fraction * 100)}% of ${formatBytes(file.size)}`,
    );
  });
  const assetId = `asset-${crypto.randomUUID().slice(0, 8)}`;
  assetNames.set(assetId, file.name);
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

  // Proxies are built after registering, not before: the clip should reach the
  // timeline the moment the file is readable, and the small copy can catch up.
  if (
    registered &&
    kind === "video" &&
    shouldBuildProxy({ kind, width, height, fileSizeBytes: file.size })
  ) {
    ensureProxy(assetId, checksum, url, durationUs, file.name);
  }
}

async function importFiles(files: FileList | File[]): Promise<void> {
  const media = Array.from(files).filter(isMediaFile);
  const skipped = Array.from(files).length - media.length;
  for (const file of media) {
    await importFile(file);
  }
  if (skipped > 0) {
    toast(
      `Skipped ${skipped} file${skipped === 1 ? "" : "s"} that ${skipped === 1 ? "is" : "are"} not image, video or audio.`,
      true,
    );
  }
}

/** Add a persistent generated SVG as a normal timeline clip. It deliberately
 * enters through asset.register + timeline.add_clip, so the cartoon uses the
 * same selection, keyframe, transition, preview and export paths as media. */
/** Fill chosen in the Cartoon Clips panel, or null to keep each preset's own
 * colour. Null rather than a default hex so an untouched picker does not
 * quietly flatten a gold star and a white speech bubble to the same swatch —
 * the shape presets carry legibility choices, not just decoration. */
let vectorFillOverride: string | null = null;

async function addVectorShape(preset: VectorShapePreset): Promise<void> {
  const source = createVectorShapeSource({
    kind: preset.id,
    fillHex: vectorFillOverride ?? preset.fillHex,
    strokeHex: preset.strokeHex,
    width: 1024,
    height: 1024,
  });
  const image = new Image();
  image.src = source.dataUri;
  const decoded = await image
    .decode()
    .then(() => true)
    .catch(() => false);
  if (!decoded) {
    toast(`Could not create the ${preset.label} cartoon clip.`, true);
    return;
  }

  const bytes = new TextEncoder().encode(source.svg);
  const checksum = await checksumBlob(new Blob([bytes]));
  const assetId = `asset-${crypto.randomUUID().slice(0, 8)}`;
  const durationUs = "5000000";
  assetNames.set(assetId, `${preset.label} cartoon`);
  mediaCache.set(source.dataUri, image);

  const registered = commit(
    buildRegisterAsset(nextCtx(), {
      asset: {
        id: assetId,
        projectId: PROJECT_ID,
        kind: "generated",
        originalUri: source.dataUri,
        checksum,
        metadata: {
          fileSizeBytes: String(source.byteLength),
          durationUs,
          width: 1024,
          height: 1024,
          frameRate: FRAME_RATE,
        },
        createdAt: new Date().toISOString(),
      },
    }),
  );
  if (!registered) return;
  addAssetToTimeline(assetId, "generated", durationUs);
  toast(`${preset.label} cartoon added — animate it in the Inspector`);
}

/**
 * Add an adjustment layer: a clip with no picture of its own, whose effects
 * apply to everything beneath it.
 *
 * It has to end up *above* the clips it adjusts, and the lowest track index is
 * the one that paints on top — so the top track is where it goes. When that
 * track already holds clips, they are moved down onto a new track first, which
 * is why this is a run of commands rather than one: a track is added beneath,
 * the top track's clips move onto it, and the adjustment takes the vacated top.
 *
 * The whole run is one gesture, so it is one Undo, and the picture is unchanged
 * by the move itself — the clips were the only visual content and they still
 * composite in the same order.
 */
async function addAdjustmentLayer(): Promise<void> {
  const seq = activeSequence();
  if (!seq) return;
  const videoTracks = seq.tracks.filter((t) => t.kind === "video");
  const top = videoTracks[0];
  if (!top) return;

  const spanUs = sequenceDurationUs(seq);
  if (BigInt(spanUs) <= 0n) {
    toast("Add some media first — an adjustment layer needs something to adjust.", true);
    return;
  }

  const assetId = `asset-${crypto.randomUUID().slice(0, 8)}`;
  const clipId = `clip-${crypto.randomUUID().slice(0, 8)}`;
  const newTrackId = `video-${crypto.randomUUID().slice(0, 8)}`;
  // No file behind it, so there is nothing to checksum. A constant stands in,
  // and `mediaHints` leaves adjustment assets out of the save entirely.
  const checksum = await checksumBlob(new Blob([new TextEncoder().encode("adjustment")]));
  assetNames.set(assetId, "Adjustment layer");

  session.beginGesture();
  if (top.clips.length > 0) {
    const added = commit(
      buildAddTrack(nextCtx(), {
        sequenceId: SEQUENCE_ID,
        track: {
          id: newTrackId,
          kind: "video",
          name: `Video ${seq.tracks.length}`,
          index: seq.tracks.length,
        },
      }),
    );
    if (!added) {
      session.endGesture();
      return;
    }
    for (const clip of top.clips) {
      commit(
        buildMoveClip(nextCtx(), {
          sequenceId: SEQUENCE_ID,
          clipId: clip.id,
          targetTrackId: newTrackId,
          timelineStartUs: clip.timelineStartUs,
        }),
      );
    }
  }

  const registered = commit(
    buildRegisterAsset(nextCtx(), {
      asset: {
        id: assetId,
        projectId: PROJECT_ID,
        kind: "adjustment",
        originalUri: "adjustment:",
        checksum,
        metadata: {
          fileSizeBytes: "0",
          // Nominal and long: a clip trims what it needs out of it, and the
          // reducer only asks that the source range fits inside.
          durationUs: "3600000000",
        },
        createdAt: new Date().toISOString(),
      },
    }),
  );
  if (registered) {
    // Spanning everything by default, because an adjustment layer that covered
    // part of the cut would look like it had simply failed on the rest.
    commit(
      buildAddClip(nextCtx(), {
        sequenceId: SEQUENCE_ID,
        trackId: top.id,
        clip: {
          id: clipId,
          assetId,
          timelineStartUs: "0",
          sourceInUs: "0",
          sourceOutUs: spanUs,
          playbackRate: { numerator: 1, denominator: 1 },
        },
      }),
    );
  }
  session.endGesture();
  selectClip(clipId);
  toast("Adjustment layer added — its effects apply to everything beneath it.");
}

/**
 * Add a clip, in whichever of the three destinations the toolbar is set to.
 *
 * This is the destination half of three-point editing. The source half is
 * already decided by the time we get here: `range` is the browser range, so in
 * and out are chosen; the mode decides where it lands and what happens to what
 * is already there.
 *
 * - **Append** puts it after the last clip on the track — the original
 *   behaviour, and still the default, because it is what adding from the bin
 *   means when you are assembling in order.
 * - **Insert** puts it at the playhead and pushes the rest later.
 * - **Overwrite** puts it at the playhead and replaces what it covers.
 *
 * Insert and overwrite each go through one command, so a ripple across five
 * clips is one undo and an agent gets the same edit through MCP. `splitClipId`
 * is supplied every time: the reducer ignores it unless the edit lands mid-clip,
 * and predicting that here would duplicate the reducer's own arithmetic.
 */
function addAssetToTimeline(
  assetId: string,
  kind: MediaAsset["kind"],
  durationUs: string,
  preferredTrackId?: string,
  range?: BrowserRange,
): void {
  const seq = activeSequence();
  if (!seq) return;
  const trackId =
    preferredTrackId ?? (kind === "audio" ? AUDIO_TRACK : VIDEO_TRACK);
  const track = seq.tracks.find((t) => t.id === trackId);
  if (!track) return;
  const clipId = `clip-${crypto.randomUUID().slice(0, 8)}`;
  const clip = {
    id: clipId,
    assetId,
    timelineStartUs:
      editMode === "append"
        ? trackEndUs(track).toString()
        : playback.currentTimeUs,
    sourceInUs: range?.inUs ?? "0",
    sourceOutUs: range?.outUs ?? durationUs,
    playbackRate: { numerator: 1, denominator: 1 } as const,
  };
  const payload = {
    sequenceId: SEQUENCE_ID,
    trackId,
    clip,
    splitClipId: `clip-${crypto.randomUUID().slice(0, 8)}`,
  };
  const added = commit(
    editMode === "insert"
      ? buildInsertClip(nextCtx(), payload)
      : editMode === "overwrite"
        ? buildOverwriteClip(nextCtx(), payload)
        : // Append has nothing to ripple or replace, so it stays the plain add
          // it always was — and `add_clip` takes no splitClipId.
          buildAddClip(nextCtx(), {
            sequenceId: SEQUENCE_ID,
            trackId,
            clip,
          }),
  );
  if (added) selectClip(clipId);
}

/**
 * Turn the selected clips into one compound clip.
 *
 * The selection moves into a new sequence and is replaced by a single clip that
 * plays it — Final Cut's compound clip, Premiere's nested sequence. Useful when
 * a run of clips has become one thing you want to move, retime or grade as a
 * unit.
 *
 * Built from existing commands inside one gesture, so it is one Undo. There is
 * no cross-sequence move command, so each clip is added to the inner sequence
 * and deleted from the outer one.
 *
 * `add_clip` deliberately takes no effects, animations, speed or blend mode —
 * those exist only through their own commands — so each is carried across
 * afterwards with the atomic "set the whole thing" command that owns it.
 * Without that, compounding would silently discard a grade, which is the kind of
 * loss someone notices much later and cannot undo their way out of.
 */
async function makeCompoundClip(): Promise<void> {
  const seq = activeSequence();
  const clipIds = selectionClipIds();
  if (!seq || clipIds.length === 0) {
    toast("Select the clips to compound first.", true);
    return;
  }

  const located = clipIds
    .map((id) => locateClip(id))
    .filter((l): l is NonNullable<typeof l> => l !== null);
  if (located.length === 0) return;

  // The compound clip occupies the span the selection covered.
  const startUs = located.reduce(
    (min, l) =>
      BigInt(l.clip.timelineStartUs) < min ? BigInt(l.clip.timelineStartUs) : min,
    BigInt(located[0]!.clip.timelineStartUs),
  );
  const endUs = located.reduce((max, l) => {
    const end =
      BigInt(l.clip.timelineStartUs) + BigInt(l.clip.timelineDurationUs);
    return end > max ? end : max;
  }, 0n);
  const spanUs = endUs - startUs;
  if (spanUs <= 0n) return;

  const innerId = `sequence-${crypto.randomUUID().slice(0, 8)}`;
  const innerVideo = `video-${crypto.randomUUID().slice(0, 8)}`;
  const innerAudio = `audio-${crypto.randomUUID().slice(0, 8)}`;
  const assetId = `asset-${crypto.randomUUID().slice(0, 8)}`;
  const compoundClipId = `clip-${crypto.randomUUID().slice(0, 8)}`;
  const checksum = await checksumBlob(
    new Blob([new TextEncoder().encode(`compound:${innerId}`)]),
  );
  assetNames.set(assetId, "Compound clip");

  session.beginGesture();
  const built = commit(
    buildCreateSequence(nextCtx(), {
      sequence: {
        id: innerId,
        name: "Compound",
        width: seq.width,
        height: seq.height,
        frameRate: seq.frameRate,
      },
    }),
  );
  if (!built) {
    session.endGesture();
    return;
  }
  for (const [id, kind] of [
    [innerVideo, "video"],
    [innerAudio, "audio"],
  ] as const) {
    commit(
      buildAddTrack(nextCtx(), {
        sequenceId: innerId,
        track: { id, kind, name: kind === "video" ? "V1" : "A1", index: kind === "video" ? 0 : 1 },
      }),
    );
  }

  for (const loc of located) {
    const clip = loc.clip;
    const innerClipId = `clip-${crypto.randomUUID().slice(0, 8)}`;
    const placed = commit(
      buildAddClip(nextCtx(), {
        sequenceId: innerId,
        trackId: loc.track.kind === "audio" ? innerAudio : innerVideo,
        clip: {
          id: innerClipId,
          assetId: clip.assetId,
          // Rebased so the selection starts at zero inside.
          timelineStartUs: (BigInt(clip.timelineStartUs) - startUs).toString(),
          sourceInUs: clip.sourceInUs,
          sourceOutUs: clip.sourceOutUs,
          playbackRate: { numerator: 1, denominator: 1 },
        },
      }),
    );
    // Deleting the original only after its copy exists. Skipping the delete on
    // failure leaves the clip where it was, which is recoverable; deleting it
    // anyway would lose the clip entirely.
    if (!placed) {
      const why = session.getLastError();
      toast(
        `Could not move ${clip.id} into the compound: ${why?.message ?? "unknown"}`,
        true,
      );
      continue;
    }

    // Carry across what add_clip does not take. Each of these is the command
    // that owns that part of a clip, so the copy goes through the engine rather
    // than around it.
    if (clip.effects.length > 0) {
      commit(
        buildUpdateClipEffects(nextCtx(), {
          sequenceId: innerId,
          clipId: innerClipId,
          effects: structuredClone(clip.effects),
        }),
      );
    }
    if ((clip.animations ?? []).length > 0) {
      commit(
        buildUpdateClipAnimations(nextCtx(), {
          sequenceId: innerId,
          clipId: innerClipId,
          animations: structuredClone(clip.animations ?? []),
        }),
      );
    }
    if (clip.blendMode !== undefined) {
      commit(
        buildSetClipBlendMode(nextCtx(), {
          sequenceId: innerId,
          clipId: innerClipId,
          blendMode: clip.blendMode,
        }),
      );
    }
    if (
      clip.playbackRate.numerator !== 1 ||
      clip.playbackRate.denominator !== 1
    ) {
      commit(
        buildSetClipSpeed(nextCtx(), {
          sequenceId: innerId,
          clipId: innerClipId,
          playbackRate: clip.playbackRate,
        }),
      );
    }

    commit(
      buildDeleteClip(nextCtx(), {
        sequenceId: SEQUENCE_ID,
        clipId: clip.id,
      }),
    );
  }

  const registered = commit(
    buildRegisterAsset(nextCtx(), {
      asset: {
        id: assetId,
        projectId: PROJECT_ID,
        kind: "sequence",
        originalUri: `sequence:${innerId}`,
        checksum,
        metadata: { fileSizeBytes: "0", durationUs: spanUs.toString() },
        createdAt: new Date().toISOString(),
      },
    }),
  );
  if (registered) {
    commit(
      buildAddClip(nextCtx(), {
        sequenceId: SEQUENCE_ID,
        trackId: located[0]!.track.id,
        clip: {
          id: compoundClipId,
          assetId,
          timelineStartUs: startUs.toString(),
          sourceInUs: "0",
          sourceOutUs: spanUs.toString(),
          playbackRate: { numerator: 1, denominator: 1 },
        },
      }),
    );
  }
  session.endGesture();
  selectedClipIds.clear();
  selectClip(compoundClipId);
  toast("Compound clip made — its contents live in their own sequence.");
}

/** Remove a clip from the timeline via the command engine (undoable). */
function deleteClip(clipId: string): void {
  if (selectedClipId === clipId) selectedClipId = null;
  commit(buildDeleteClip(nextCtx(), { sequenceId: SEQUENCE_ID, clipId }));
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
  // Back the canvas with physical device pixels (retina = devicePixelRatio 2+)
  // so full-res media isn't downsampled to CSS pixels and shown blurry. CSS
  // (#preview max-width/height:100%) scales it back down for a crisp preview.
  const dpr = window.devicePixelRatio || 1;
  const cw = stageEl.clientWidth;
  const ch = stageEl.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cctx.imageSmoothingQuality = "high";
  cctx.clearRect(0, 0, cw, ch);

  const seq = activeSequence();
  // Deep: a compound clip plays a whole sequence, and what the viewer must see
  // is the media inside it, positioned in this timeline.
  const previewProject = session.getProject();
  const layers =
    seq && previewProject
      ? resolveAtTimeDeep(previewProject, seq.id, playback.currentTimeUs)
      : [];
  const visual = layers.filter((l) => {
    const a = findAsset(l.assetId);
    return a && a.kind !== "audio";
  });

  stageEmpty.style.display = visual.length === 0 ? "block" : "none";
  if (visual.length === 0) {
    drawScope();
    return;
  }

  // Timed so auto-scaling has something real to judge. Only the layer painting
  // is measured: the scope pass below and the canvas resize above are not what
  // the budget controls, and including them would make the controller chase
  // costs it cannot change.
  const paintedAt = performance.now();
  gradedThisFrame = false;

  // Resolve order is track order, ascending by index, and this reverses it —
  // so the *lowest* index is painted last and ends up on top. That is what lets
  // an adjustment layer read the canvas and find everything beneath it already
  // painted and nothing above it painted yet.
  for (const layer of [...visual].reverse()) {
    const loc = locateClipAnywhere(layer.clipId);
    if (loc) {
      paintLayer(
        cctx,
        loc.clip,
        layer.sourceTimeUs,
        clipLocalTimeUs(playback.currentTimeUs, layer.timelineStartUs),
        cw,
        ch,
        previewBudget(),
      );
    }
  }
  // Only frames that actually graded are evidence about this machine, and only
  // while auto is in force — a pinned preference is an instruction, not a
  // hypothesis to be revised.
  if (gradedThisFrame && qualityPreference === "auto") {
    adaptiveQuality = observeFrame(
      adaptiveQuality,
      performance.now() - paintedAt,
    );
  }

  // Measured after everything is painted, so a scope reads exactly what the
  // viewer is looking at rather than an intermediate state.
  drawScope();
}

// ==========================================================================
// Scopes
// ==========================================================================

type ScopeKind = "off" | "histogram" | "waveform" | "vectorscope";

let scopeKind: ScopeKind = "off";

/**
 * How much of the preview a scope reads.
 *
 * A scope wants a fair sample of the picture, not every pixel of it: reading a
 * 4K canvas back on every redraw costs more than drawing it did. Sampling one
 * pixel in nine changes the counts by a constant factor and the shape not at
 * all, which is all a scope is read for.
 */
const SCOPE_SAMPLE_STEP = 9;

/** Read the displayed frame back for measuring, or null when there is none. */
function scopePixels(): ImageData | null {
  if (scopeKind === "off") return null;
  if (canvas.width === 0 || canvas.height === 0) return null;
  try {
    return cctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    // A tainted canvas cannot be read back. Nothing here is worth breaking the
    // preview over.
    return null;
  }
}

/** Paint whichever scope is selected from the current preview. */
function drawScope(): void {
  const scopeCanvas = $<HTMLCanvasElement>("scope-canvas");
  const readout = $("scope-readout");
  scopeCanvas.classList.toggle("hidden", scopeKind === "off");
  if (scopeKind === "off") {
    readout.textContent = "";
    return;
  }
  const ctx = scopeCanvas.getContext("2d");
  const frame = scopePixels();
  if (!ctx) return;
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, scopeCanvas.width, scopeCanvas.height);
  if (!frame) {
    readout.textContent = "no picture";
    return;
  }
  if (scopeKind === "histogram") drawHistogram(ctx, scopeCanvas, frame, readout);
  else if (scopeKind === "waveform")
    drawLumaWaveform(ctx, scopeCanvas, frame, readout);
  else drawVectorscope(ctx, scopeCanvas, frame, readout);
}

function drawHistogram(
  ctx: CanvasRenderingContext2D,
  scopeCanvas: HTMLCanvasElement,
  frame: ImageData,
  readout: HTMLElement,
): void {
  const bins = histogram(frame.data, SCOPE_SAMPLE_STEP);
  const tallest = Math.max(
    1,
    ...bins.red,
    ...bins.green,
    ...bins.blue,
  );
  // Additive, so where the three channels agree the trace reads white — the
  // conventional RGB parade-less histogram.
  ctx.globalCompositeOperation = "lighter";
  const channels: [number[], string][] = [
    [bins.red, "rgba(255,72,72,0.85)"],
    [bins.green, "rgba(72,255,120,0.85)"],
    [bins.blue, "rgba(96,140,255,0.85)"],
  ];
  for (const [channel, colour] of channels) {
    ctx.fillStyle = colour;
    for (let level = 0; level < 256; level++) {
      const height =
        ((channel[level] ?? 0) / tallest) * (scopeCanvas.height - 2);
      const x = (level / 256) * scopeCanvas.width;
      ctx.fillRect(x, scopeCanvas.height - height, scopeCanvas.width / 256, height);
    }
  }
  ctx.globalCompositeOperation = "source-over";
  const clipped = clippedFraction(bins.luma, bins.total);
  readout.textContent = `clip ${(clipped.black * 100).toFixed(1)}% / ${(
    clipped.white * 100
  ).toFixed(1)}%`;
}

function drawLumaWaveform(
  ctx: CanvasRenderingContext2D,
  scopeCanvas: HTMLCanvasElement,
  frame: ImageData,
  readout: HTMLElement,
): void {
  const columns = scopeCanvas.width;
  const scope = waveform(
    frame.data,
    frame.width,
    frame.height,
    columns,
    SCOPE_SAMPLE_STEP,
  );
  const image = ctx.createImageData(scopeCanvas.width, scopeCanvas.height);
  const peak = Math.max(1, scope.peak);
  for (let x = 0; x < columns; x++) {
    const bucket = scope.columns[x]!;
    for (let level = 0; level < 256; level++) {
      const count = bucket[level] ?? 0;
      if (count === 0) continue;
      // Brightness is density, so a flat area reads as a bright line and a
      // gradient as a soft band — the way a waveform monitor behaves.
      const intensity = Math.min(255, Math.round((count / peak) * 900));
      const y = Math.min(
        scopeCanvas.height - 1,
        Math.round((1 - level / 255) * (scopeCanvas.height - 1)),
      );
      const i = (y * scopeCanvas.width + x) * 4;
      image.data[i] = Math.min(255, (image.data[i] ?? 0) + intensity * 0.5);
      image.data[i + 1] = Math.min(255, (image.data[i + 1] ?? 0) + intensity);
      image.data[i + 2] = Math.min(255, (image.data[i + 2] ?? 0) + intensity * 0.7);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  readout.textContent = "0–100 IRE, left to right";
}

function drawVectorscope(
  ctx: CanvasRenderingContext2D,
  scopeCanvas: HTMLCanvasElement,
  frame: ImageData,
  readout: HTMLElement,
): void {
  const size = 96;
  const scope = vectorscope(frame.data, size, SCOPE_SAMPLE_STEP);
  const side = Math.min(scopeCanvas.width, scopeCanvas.height);
  const originX = (scopeCanvas.width - side) / 2;
  const cell = side / size;
  const peak = Math.max(1, scope.peak);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const count = scope.grid[y * size + x] ?? 0;
      if (count === 0) continue;
      const intensity = Math.min(1, (count / peak) * 6);
      ctx.fillStyle = `rgba(120,255,190,${0.15 + intensity * 0.85})`;
      ctx.fillRect(originX + x * cell, y * cell, Math.ceil(cell), Math.ceil(cell));
    }
  }
  // Graticule: the centre is neutral, the ring is full saturation.
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath();
  ctx.arc(originX + side / 2, side / 2, side / 2 - 1, 0, Math.PI * 2);
  ctx.moveTo(originX, side / 2);
  ctx.lineTo(originX + side, side / 2);
  ctx.moveTo(originX + side / 2, 0);
  ctx.lineTo(originX + side / 2, side);
  ctx.stroke();

  const centre = chromaCentre(frame.data, SCOPE_SAMPLE_STEP);
  readout.textContent = `cast ${centre.distance.toFixed(1)} · sat ${(
    scope.maxSaturation * 100
  ).toFixed(0)}%`;
}

/** Crop/reframe is a non-destructive effect: it narrows the source rect
 * sampled from the media rather than touching the media itself. Shared by
 * live preview and export so both agree on the exact same rect. */
function resolveCropRect(
  clip: TimelineClip,
  mw: number,
  mh: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const cropFx = clip.effects.find(
    (e) => e.enabled && e.type === "transform.crop",
  );
  if (!cropFx) return { sx: 0, sy: 0, sw: mw, sh: mh };
  const p = cropFx.params as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  return {
    sx: p.x * mw,
    sy: p.y * mh,
    sw: Math.max(1, p.width * mw),
    sh: Math.max(1, p.height * mh),
  };
}

/** Renders one composited clip layer — including all baked-in effects — onto
 * `ctx`. Used for both the live preview canvas and offscreen export
 * rendering, so effects are guaranteed identical between what you see and
 * what you export. */
/** Videos with a seek in flight. One pending redraw per element is enough —
 * the redraw reads whatever the latest requested time is. */
const seekingVideos = new WeakSet<HTMLVideoElement>();

/**
 * Schedules a preview redraw for when `video` has a frame to give.
 *
 * Two cases need it: a seek that has not decoded yet, and a freshly imported
 * clip sitting at time 0 that has never decoded anything at all. The second is
 * not a seek — the element is already at the requested time — so `seeked`
 * alone would never fire; `loadeddata` covers it.
 *
 * `requestVideoFrameCallback` is the precise signal where available (it fires
 * when a frame is ready to present). The redraw cannot loop: by the time it
 * runs the element is within tolerance of the target and has data, so
 * drawLayer does not schedule again.
 */
function redrawWhenFrameReady(video: HTMLVideoElement): void {
  if (seekingVideos.has(video)) return;
  seekingVideos.add(video);
  const settle = (): void => {
    if (!seekingVideos.has(video)) return;
    seekingVideos.delete(video);
    drawPreview();
  };
  if (typeof video.requestVideoFrameCallback === "function") {
    video.requestVideoFrameCallback(() => settle());
  }
  video.addEventListener("seeked", settle, { once: true });
  video.addEventListener("loadeddata", settle, { once: true });
}

/**
 * Draw an adjustment layer: apply the clip's effects to what is already on the
 * canvas, rather than to media of its own.
 *
 * This works because of the order the render loop already paints in. Layers are
 * drawn beneath-first — the last track first, the first track last — so by the
 * time an adjustment layer's turn comes, everything below it is on the canvas
 * and nothing above it is. Reading the canvas back at that moment *is* "the
 * composite of everything beneath", with no separate accumulation buffer and no
 * second pass.
 *
 * The layer's own opacity, transition ramp and blend mode still apply, to the
 * adjusted copy on its way back down. That is what makes a half-opacity
 * adjustment layer mean "half the grade" and a Multiply one mean "darken by the
 * grade", rather than either being a special case.
 *
 * A CSS-filter effect and a pixel effect both work, by the same split
 * `drawLayer` uses: pixels through `gradeUncached`, filters through
 * `ctx.filter`.
 */
/**
 * Paint one resolved layer, whichever kind it is.
 *
 * Every render path goes through here — preview, MP4 and GIF — so an adjustment
 * layer cannot work in one and be missing from another. That is the same reason
 * `drawLayer` was shared in the first place, and it is why the blend-mode e2e
 * measures an exported file rather than the preview canvas.
 */
function paintLayer(
  ctx: CanvasRenderingContext2D,
  clip: TimelineClip,
  sourceTimeUs: string,
  localTimeUs: string,
  cw: number,
  ch: number,
  /** Pixel budget for CPU grading, or 0 for none. Preview passes a budget so
   * its cost does not scale with the viewer's screen; export passes none,
   * because a render must be full quality whatever machine made it. */
  gradeBudgetPx = 0,
): void {
  if (findAsset(clip.assetId)?.kind === "adjustment") {
    drawAdjustmentLayer(ctx, clip, localTimeUs, cw, ch, gradeBudgetPx);
    return;
  }
  drawLayer(ctx, clip, sourceTimeUs, localTimeUs, cw, ch);
}

function drawAdjustmentLayer(
  ctx: CanvasRenderingContext2D,
  clip: TimelineClip,
  localTimeUs: string,
  cw: number,
  ch: number,
  gradeBudgetPx = 0,
): void {
  if (cw <= 0 || ch <= 0) return;
  // Before/After compare shows the untouched picture, so an adjustment layer
  // contributes nothing while it is held — the same rule drawLayer follows.
  if (compareShowOriginal) return;

  const gradingFx = clip.effects.filter((e) => e.enabled && runsAsPixels(e));
  const staticTransform = previewTransform(clip);
  const filter = staticTransform.filter;
  if (gradingFx.length === 0 && filter === "") return;

  // Opacity is read the same way a media clip reads it, so an animated Opacity
  // keyframe ramps the grade in exactly as it would ramp a picture in.
  const transform = composeCanvasLayerTransform(
    staticTransform,
    resolveLayerAnimationTransform(clip, localTimeUs),
    cw,
    ch,
  );

  // Snapshot what is beneath. Reading the canvas is the whole mechanism, so it
  // is done once per layer rather than per effect.
  //
  // Unlike a media clip — which grades at its own resolution and caches the
  // result — this grades the live canvas every frame, so its cost follows the
  // preview's size and therefore the viewer's window and pixel ratio. A budget
  // keeps that from making the same project four times dearer on a retina
  // screen than on a 1080p one. The grade is a per-pixel tone and colour
  // operation, so computing it on a smaller copy and scaling back is very close
  // to computing it at full size; export passes no budget and gets exactly it.
  const graded = fitWithinBudget(cw, ch, gradeBudgetPx);
  const beneath = document.createElement("canvas");
  beneath.width = graded.width;
  beneath.height = graded.height;
  const bctx = beneath.getContext("2d", { willReadFrequently: true });
  if (!bctx) return;
  bctx.drawImage(ctx.canvas, 0, 0, cw, ch, 0, 0, graded.width, graded.height);

  gradedThisFrame = true;
  const adjusted =
    gradingFx.length > 0
      ? gradeUncached(
          beneath,
          graded.width,
          graded.height,
          gradingFx,
          clip.masks ?? [],
        )
      : beneath;

  const transition = sampleClipTransition(clip, localTimeUs);
  ctx.save();
  ctx.globalAlpha = transform.alpha * transition.opacity;
  ctx.filter = filter || "none";
  ctx.globalCompositeOperation = compositeOperation(clip.blendMode ?? "normal");
  ctx.drawImage(adjusted, 0, 0, cw, ch);
  ctx.restore();
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  clip: TimelineClip,
  sourceTimeUs: string,
  localTimeUs: string,
  cw: number,
  ch: number,
): void {
  const asset = findAsset(clip.assetId);
  if (!asset) return;
  const media = mediaFor(asset);
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
      if (Math.abs(media.currentTime - target) > 0.05) {
        media.currentTime = target;
        // Decoding is asynchronous: the frame for `target` is not available to
        // the drawImage below, which would paint the previous one and leave it
        // there. Redraw once the frame actually lands.
        redrawWhenFrameReady(media);
      } else if (media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        // Already at the right time but nothing decoded yet — a clip that was
        // just imported and sits at 0. Without this the preview stays empty
        // until the playhead is moved.
        redrawWhenFrameReady(media);
      }
    }
  }

  // Before/After compare: while held, draw the clip's raw media with no
  // effects, crop, or overlays — the "before". Preview-only (export never
  // sets this flag), so what you export is always the edited result.
  if (compareShowOriginal) {
    const s = Math.min(cw / mw, ch / mh);
    const w = mw * s;
    const h = mh * s;
    ctx.save();
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.drawImage(media, (cw - w) / 2, (ch - h) / 2, w, h);
    ctx.restore();
    return;
  }

  const { sx, sy, sw, sh } = resolveCropRect(clip, mw, mh);

  const scale = Math.min(cw / sw, ch / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;

  const staticTransform = previewTransform(clip);
  const animation = resolveLayerAnimationTransform(clip, localTimeUs);
  const transform = composeCanvasLayerTransform(
    staticTransform,
    animation,
    cw,
    ch,
  );

  // Background removal (color key) needs per-pixel work, so it runs on an
  // offscreen canvas whose result is drawn in place of the raw media.
  const bgFx = clip.effects.find(
    (e) => e.enabled && e.type === "fx.remove_background",
  );
  let drawable: CanvasImageSource = bgFx
    ? removeBackground(media, mw, mh, bgFx)
    : media;

  // Identity of the pixels `drawable` currently holds, not just of the asset
  // they came from. Every cache below keys off this: a stylized render of a
  // keyed-out, graded frame is a different image from one of the raw media,
  // and keying by asset alone would serve the stale one.
  let sourceKey = assetUri(asset);
  if (bgFx) sourceKey += `|bg:${JSON.stringify(bgFx.params)}`;

  // Grading runs before stylization, which is the order a photographer works
  // in: correct the exposure and colour of the photograph, then paint over the
  // corrected result. Within the grade, the clip's own stack order decides.
  const gradingFx = clip.effects.filter((e) => e.enabled && runsAsPixels(e));
  if (gradingFx.length > 0) {
    const masks = clip.masks ?? [];
    drawable = grade(sourceKey, drawable, mw, mh, gradingFx, masks);
    sourceKey += `|grade:${gradeSignature(gradingFx)}|${maskSignature(masks, gradingFx)}`;
  }

  // Painterly passes are whole-image pixel work — Kuwahara alone is O(r^2)
  // per pixel — and drawLayer runs once per exported frame. The result depends
  // only on the media and the parameters, never on the playhead, so it is
  // computed once per (asset, effect) and reused.
  const artFx = clip.effects.find(
    (e) =>
      e.enabled &&
      e.type.startsWith("art."),
  );
  if (artFx) {
    drawable = stylize(sourceKey, drawable, mw, mh, artFx);
  }

  // Portrait blur needs the subject mask, which costs a U²-Net inference —
  // far too slow per frame. The mask is cached per asset and requested once;
  // until it lands the clip draws unblurred rather than blurring the subject
  // along with everything else, which is what the old implementation did.
  const portraitFx = clip.effects.find(
    (e) => e.enabled && e.type === "photo.portrait_blur",
  );
  if (portraitFx) {
    const mask = portraitMaskFor(assetUri(asset), drawable, mw, mh);
    if (mask) {
      drawable = compositePortraitBlur(drawable, mw, mh, mask, portraitFx);
    }
  }

  // Transitions are a timed opacity ramp on one end of the clip. What the ramp
  // reads as is decided by whatever is underneath: nothing -> a fade against
  // the background, a lower track -> a cross-track crossfade, the neighbouring
  // clip kept alive by a bounded overlap -> a same-track crossfade.
  const transition = sampleClipTransition(clip, localTimeUs);

  ctx.save();
  // A dip ramps against an explicit colour rather than against whatever
  // happens to be behind it, so the colour is laid down under the clip first
  // and the ramp then reveals or hides the media over it. Painted in the
  // clip's own destination rect, untransformed: a dip should not scale or spin
  // with an animated clip, and should not cover other tracks.
  if (transition.dipColorHex !== undefined) {
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    // A dip is an explicit colour laid *under* the clip, so it is painted
    // normally whatever the clip blends as.
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = transition.dipColorHex;
    ctx.fillRect(dx, dy, dw, dh);
  }
  ctx.globalAlpha = transform.alpha * transition.opacity;
  ctx.filter = staticTransform.filter || "none";
  // How this clip combines with what is already on the canvas. Set inside the
  // save/restore the layer already has, so it cannot leak into the next clip —
  // and set explicitly even for "normal", because passing an unknown value to
  // `globalCompositeOperation` is silently ignored and would leave the previous
  // layer's operation in force.
  ctx.globalCompositeOperation = compositeOperation(clip.blendMode ?? "normal");
  const ccx = dx + dw / 2;
  const ccy = dy + dh / 2;
  // A slide contributes a normalized offset on the same convention as
  // transform.position_x/y, so it scales with the output exactly as animation
  // does and preview/GIF/MP4 stay in agreement.
  ctx.translate(
    ccx + transform.offsetXPx + transition.offsetX * cw,
    ccy + transform.offsetYPx + transition.offsetY * ch,
  );
  if (transform.rotationDegrees) {
    ctx.rotate((transform.rotationDegrees * Math.PI) / 180);
  }
  ctx.scale(transform.scaleX, transform.scaleY);
  ctx.drawImage(drawable, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  // Overlays belong to the clip and therefore receive the same animation, but
  // retain their previous behavior of not passing through the media filter.
  ctx.filter = "none";
  drawOverlays(ctx, clip, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
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
    // A masked instance was already applied as pixels; adding it to the filter
    // string too would apply it twice, once globally.
    if (runsAsPixels(fx)) continue;
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
  ctx: CanvasRenderingContext2D,
  clip: TimelineClip,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const inheritedAlpha = ctx.globalAlpha;
  for (const fx of clip.effects) {
    if (!fx.enabled) continue;
    if (fx.type === "color.vignette") {
      const amount = getParamNumber(fx, "amount", 0.5);
      const grad = ctx.createRadialGradient(
        dx + dw / 2,
        dy + dh / 2,
        Math.min(dw, dh) * 0.3,
        dx + dw / 2,
        dy + dh / 2,
        Math.max(dw, dh) * 0.7,
      );
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, `rgba(0,0,0,${amount})`);
      ctx.fillStyle = grad;
      ctx.fillRect(dx, dy, dw, dh);
    } else if (fx.type === "color.tint" || fx.type === "color.duotone") {
      const color =
        fx.type === "color.tint"
          ? getParamString(fx, "colorHex", "#ff5a00")
          : getParamString(fx, "highlightsHex", "#ff5a00");
      const amount =
        fx.type === "color.tint" ? getParamNumber(fx, "amount", 0.2) : 0.3;
      ctx.save();
      ctx.globalAlpha = inheritedAlpha * amount;
      ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = color;
      ctx.fillRect(dx, dy, dw, dh);
      ctx.restore();
    } else if (fx.type === "fx.retro_noise") {
      const spacing = getParamNumber(fx, "scanlineSpacing", 6);
      ctx.save();
      ctx.globalAlpha =
        inheritedAlpha * getParamNumber(fx, "noiseAmount", 0.25);
      ctx.fillStyle = "#000";
      for (let y = dy; y < dy + dh; y += spacing) ctx.fillRect(dx, y, dw, 1);
      ctx.restore();
    } else if (fx.type === "fx.border") {
      const w = getParamNumber(fx, "borderWidthPx", 12);
      ctx.strokeStyle = getParamString(fx, "borderColorHex", "#ffffff");
      ctx.lineWidth = w;
      ctx.strokeRect(dx + w / 2, dy + w / 2, dw - w, dh - w);
    } else if (fx.type === "fx.text") {
      drawTextOverlay(ctx, fx, dx, dy, dw, dh, inheritedAlpha);
    }
  }
}

/**
 * Burn a caption into the frame.
 *
 * Every dimension is derived from the drawn rect rather than fixed in pixels:
 * the font size is a ratio of height and the position is normalized, so the
 * caption lands in the same place at preview resolution and at export
 * resolution. That is the same convention transform.position_x/y uses, and it
 * is what keeps preview, GIF and MP4 agreeing.
 */
function drawTextOverlay(
  ctx: CanvasRenderingContext2D,
  fx: EffectInstance,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  inheritedAlpha: number,
): void {
  const text = getParamString(fx, "text", "");
  if (text.trim() === "") return;

  const fontSize = Math.max(1, getParamNumber(fx, "fontSizeRatio", 0.08) * dh);
  const outlineWidth = Math.max(1, fontSize * 0.12);

  ctx.save();
  ctx.globalAlpha = inheritedAlpha;
  ctx.font = `700 ${fontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  // Wrap inside 90% of the frame so descenders and the outline never touch the
  // edge. Measurement comes from this very context, so the layout matches the
  // font that will actually be drawn.
  const lines = layoutTextLines(text, dw * 0.9, (line) =>
    ctx.measureText(line).width,
  );
  const lineHeight = fontSize * 1.2;
  const blockHeight = lineHeight * lines.length;
  const centreX = dx + getParamNumber(fx, "x", 0.5) * dw;
  // y positions the block's centre, so 0.5 is genuinely centred whatever the
  // line count.
  const startY =
    dy + getParamNumber(fx, "y", 0.85) * dh - blockHeight / 2 + lineHeight / 2;

  ctx.strokeStyle = getParamString(fx, "outlineHex", "#000000");
  ctx.lineWidth = outlineWidth;
  ctx.fillStyle = getParamString(fx, "colorHex", "#ffffff");
  lines.forEach((line, index) => {
    const y = startY + index * lineHeight;
    // Outline first, fill over it: the reverse leaves the stroke eating into
    // the glyph and thinning the text.
    if (outlineWidth > 0) ctx.strokeText(line, centreX, y);
    ctx.fillText(line, centreX, y);
  });
  ctx.restore();
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
/**
 * Subject masks for portrait blur, one per asset.
 *
 * Segmentation is a U²-Net inference — hundreds of milliseconds — so it cannot
 * run inside drawLayer, which repaints on every seek and once per exported
 * frame. The mask depends only on the source media, not on the playhead or the
 * effect's parameters, so one result serves every frame of a still clip.
 *
 * A null entry means "asked for, still running": it stops a repainting preview
 * from queueing an inference per frame.
 */
const portraitMaskCache = new Map<string, Mask | null>();

function portraitMaskFor(
  assetUri: string,
  source: CanvasImageSource,
  width: number,
  height: number,
): Mask | undefined {
  const cached = portraitMaskCache.get(assetUri);
  if (cached !== undefined) return cached ?? undefined;

  portraitMaskCache.set(assetUri, null);
  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  const octx = off.getContext("2d", { willReadFrequently: true })!;
  octx.drawImage(source, 0, 0, width, height);
  const image = octx.getImageData(0, 0, width, height);

  void segmentForeground({ width, height, data: image.data }, U2NETP_MODEL)
    .then((mask) => {
      portraitMaskCache.set(assetUri, mask);
      drawPreview();
      toast("Portrait subject detected — background blurred.");
    })
    .catch(() => {
      // Leave the entry null so it is not retried on every repaint; the clip
      // keeps drawing sharp rather than blurring the subject too.
      toast("Could not detect a subject for portrait blur.", true);
    });
  return undefined;
}

/** Blurred background composited under the sharp, masked subject. */
function compositePortraitBlur(
  source: CanvasImageSource,
  width: number,
  height: number,
  mask: Mask,
  fx: EffectInstance,
): HTMLCanvasElement {
  const radius = getParamNumber(fx, "blurRadiusPx", 15);
  const bokeh = getParamNumber(fx, "bokehStrength", 0.4);
  const subjectScale = getParamNumber(fx, "subjectScale", 1);

  // Background: the whole frame blurred, with highlights bloomed so the result
  // reads as defocus rather than a smudge.
  const bg = document.createElement("canvas");
  bg.width = width;
  bg.height = height;
  const bgCtx = bg.getContext("2d", { willReadFrequently: true })!;
  bgCtx.filter = radius > 0 ? `blur(${radius}px)` : "none";
  bgCtx.drawImage(source, 0, 0, width, height);
  bgCtx.filter = "none";
  if (bokeh > 0) {
    const pixels = bgCtx.getImageData(0, 0, width, height);
    bloomHighlights(pixels.data, bokeh);
    bgCtx.putImageData(pixels, 0, 0);
  }

  // Subject: the sharp frame, keyed to the (optionally biased) mask. Feathering
  // the alpha keeps the cut-out from looking like a sticker.
  const biased = featherMask(biasSubjectMask(mask, subjectScale), 2);
  const fg = document.createElement("canvas");
  fg.width = width;
  fg.height = height;
  const fgCtx = fg.getContext("2d", { willReadFrequently: true })!;
  fgCtx.drawImage(source, 0, 0, width, height);
  const subject = fgCtx.getImageData(0, 0, width, height);
  for (let i = 0, p = 0; i < subject.data.length; i += 4, p++) {
    subject.data[i + 3] = Math.min(subject.data[i + 3]!, biased.data[p]!);
  }
  fgCtx.putImageData(subject, 0, 0);

  bgCtx.drawImage(fg, 0, 0);
  return bg;
}

/**
 * Cached painterly renders, keyed by asset and by the exact parameters used.
 *
 * Including the parameters in the key is what makes the cache correct rather
 * than merely fast: dragging a slider has to re-render, and a stale entry
 * would silently show the previous setting.
 */
const artCache = new Map<string, HTMLCanvasElement>();

function stylize(
  sourceKey: string,
  source: CanvasImageSource,
  width: number,
  height: number,
  fx: EffectInstance,
): CanvasImageSource {
  const key = `${sourceKey}|${fx.type}|${JSON.stringify(fx.params)}|${width}x${height}`;
  const cached = artCache.get(key);
  if (cached) return cached;

  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  const octx = off.getContext("2d", { willReadFrequently: true })!;
  octx.drawImage(source, 0, 0, width, height);
  const image = octx.getImageData(0, 0, width, height);
  const raster = { width, height, data: image.data };

  let result;
  if (fx.type === "art.pencil_sketch") {
    result = pencilSketch(
      raster,
      getParamNumber(fx, "strength", 1),
      getParamNumber(fx, "grain", 0.25),
    );
  } else if (fx.type === "art.oil_painting") {
    result = oilPainting(raster, getParamNumber(fx, "radiusPx", 4));
  } else if (fx.type === "art.watercolor") {
    result = watercolor(
      raster,
      getParamNumber(fx, "poolRadiusPx", 3),
      getParamNumber(fx, "edgeStrength", 0.7),
      getParamNumber(fx, "grain", 0.3),
    );
  } else if (fx.type === "art.crosshatch") {
    result = crosshatch(
      raster,
      getParamNumber(fx, "spacingPx", 5),
      getParamNumber(fx, "darkness", 1),
    );
  } else if (fx.type === "art.halftone") {
    result = halftone(
      raster,
      getParamNumber(fx, "cellPx", 6),
      getParamNumber(fx, "angleDegrees", 45),
    );
  } else {
    result = cartoonPosterize(
      raster,
      getParamNumber(fx, "levels", 5),
      getParamNumber(fx, "edgeStrength", 0.8),
    );
  }
  // Write back through the ImageData we already read, rather than building a
  // new one: its buffer is already the right shape for this context.
  image.data.set(result.data);
  octx.putImageData(image, 0, 0);

  // Unbounded growth would be a leak across a long session; the cache exists
  // for repeated frames of one export, not for the whole project history.
  if (artCache.size > 12) {
    const oldest = artCache.keys().next().value;
    if (oldest !== undefined) artCache.delete(oldest);
  }
  artCache.set(key, off);
  return off;
}

/** The grading effects, in the order the renderer must apply them: the clip's
 * own stack order, so re-ordering the stack in the inspector re-orders the
 * grade rather than being silently ignored. */
/**
 * Effects that normally ride the canvas filter string but have a pixel
 * implementation to fall back on.
 *
 * A CSS filter applies to the whole layer and knows nothing about regions, so
 * an effect drawn that way cannot be masked. Rather than refusing to mask
 * these — the reference model is that *any* adjustment can be local — a masked
 * instance is rerouted through the pixel pass, where a mask means something.
 * Unmasked instances keep the cheaper filter path.
 */
const PIXEL_FALLBACK_TYPES: ReadonlySet<string> = new Set([
  "color.brightness",
  "color.contrast",
  "color.saturate",
  "color.exposure",
  "color.grayscale",
  "color.sepia",
  "color.invert",
  "color.hue_rotate",
  "blur.gaussian",
]);

/** Whether this effect will be applied as pixels rather than as a filter. */
function runsAsPixels(fx: EffectInstance): boolean {
  return (
    GRADING_TYPES.has(fx.type) ||
    (fx.maskId !== undefined && PIXEL_FALLBACK_TYPES.has(fx.type))
  );
}

/**
 * Grading effects whose output for a pixel depends on that pixel alone.
 *
 * A stack made only of these is a pure function from RGB to RGB, so it can be
 * sampled once into a 3D table and applied by lookup — see `lut3d`. The two
 * grading effects missing from this list are the two that read a pixel's
 * neighbours: Presence (clarity, texture, dehaze) works on local contrast, and
 * Noise Reduction is a spatial filter by definition. A table cannot represent
 * either, so a stack containing one takes the direct path.
 *
 * `isPointwise` in raster-tools exists to check a claim like this by
 * experiment rather than assertion.
 */
const POINTWISE_GRADING_TYPES: ReadonlySet<string> = new Set([
  "color.white_balance",
  "color.levels",
  "color.tone_curve",
  "color.curves",
  "color.vibrance",
  "light.tone",
  "color.hsl_mixer",
  "color.color_grading",
]);

const GRADING_TYPES: ReadonlySet<string> = new Set([
  "color.white_balance",
  "color.levels",
  "color.tone_curve",
  "color.curves",
  "color.vibrance",
  "light.tone",
  "color.hsl_mixer",
  "color.color_grading",
  "fx.presence",
  "detail.noise_reduction",
]);

/**
 * Colour grading passes, cached like the painterly ones.
 *
 * These are per-pixel work over the whole frame and drawLayer runs once per
 * exported frame, but the result depends only on the media and the parameters,
 * never on the playhead — so one render serves every frame of a still clip and
 * a slider drag re-renders because the parameters are part of the key.
 */
const gradeCache = new Map<string, HTMLCanvasElement>();

/** Everything about a grade that changes its pixels: the ordered list of
 * passes and their exact parameters. Shared by the grade cache and by the
 * caches downstream of it, which see graded pixels rather than raw ones. */
function gradeSignature(gradingFx: EffectInstance[]): string {
  return gradingFx
    .map((fx) => `${fx.type}:${JSON.stringify(fx.params)}`)
    .join("|");
}

/** Everything about the masks in play that changes the rendered pixels: only
 * the masks actually referenced, so editing an unused one does not invalidate
 * a cache entry. */
function maskSignature(
  masks: readonly ClipMask[],
  gradingFx: readonly EffectInstance[],
): string {
  const used = new Set(
    gradingFx.map((fx) => fx.maskId).filter((id): id is string => !!id),
  );
  if (used.size === 0) return "";
  return masks
    .filter((mask) => used.has(mask.id))
    .map((mask) => `${mask.id}:${JSON.stringify(mask.contributions)}`)
    .join("|");
}

function gradeImage(image: RasterImage, fx: EffectInstance): RasterImage {
  // --- masked instances of the filter-based effects ---
  if (fx.type === "color.brightness") {
    const factor = 1 + getParamNumber(fx, "amount", 0);
    return mapPixels(image, undefined, (r, g, b) => [
      r * factor,
      g * factor,
      b * factor,
    ]);
  }
  if (fx.type === "color.contrast") {
    return adjustContrast(image, (getParamNumber(fx, "amount", 1) - 1) * 100);
  }
  if (fx.type === "color.saturate") {
    return saturation(image, (getParamNumber(fx, "amount", 1) - 1) * 100);
  }
  if (fx.type === "color.exposure") {
    return adjustExposure(image, getParamNumber(fx, "amount", 0));
  }
  if (fx.type === "color.grayscale") {
    const amount = getParamNumber(fx, "amount", 1);
    return mapPixels(image, undefined, (r, g, b) => {
      const grey = luma(r, g, b);
      return [
        r + (grey - r) * amount,
        g + (grey - g) * amount,
        b + (grey - b) * amount,
      ];
    });
  }
  if (fx.type === "color.sepia") {
    // The same matrix the CSS `sepia()` filter uses, so a masked instance and
    // an unmasked one look alike.
    const amount = getParamNumber(fx, "amount", 1);
    return mapPixels(image, undefined, (r, g, b) => {
      const sr = 0.393 * r + 0.769 * g + 0.189 * b;
      const sg = 0.349 * r + 0.686 * g + 0.168 * b;
      const sb = 0.272 * r + 0.534 * g + 0.131 * b;
      return [
        r + (sr - r) * amount,
        g + (sg - g) * amount,
        b + (sb - b) * amount,
      ];
    });
  }
  if (fx.type === "color.invert") {
    const amount = getParamNumber(fx, "amount", 1);
    return mapPixels(image, undefined, (r, g, b) => [
      r + (255 - r - r) * amount,
      g + (255 - g - g) * amount,
      b + (255 - b - b) * amount,
    ]);
  }
  if (fx.type === "color.hue_rotate") {
    const degrees = getParamNumber(fx, "angleDegrees", 0);
    return mapPixels(image, undefined, (r, g, b) => {
      const [h, sat, l] = rgbToHsl(r, g, b);
      return hslToRgb(h + degrees, sat, l);
    });
  }
  if (fx.type === "blur.gaussian") {
    return boxBlurRgb(image, getParamNumber(fx, "radiusPx", 0));
  }


  if (fx.type === "color.white_balance") {
    return whiteBalance(
      image,
      getParamNumber(fx, "temperature", 0),
      getParamNumber(fx, "tint", 0),
    );
  }
  if (fx.type === "color.levels") {
    return levels(
      image,
      getParamNumber(fx, "blackPoint", 0),
      getParamNumber(fx, "whitePoint", 1),
      getParamNumber(fx, "gamma", 1),
    );
  }
  if (fx.type === "color.curves") {
    return applyCurves(image, curveSetOf(fx));
  }
  if (fx.type === "color.tone_curve") {
    return toneCurve(
      image,
      getParamNumber(fx, "shadows", 0),
      getParamNumber(fx, "midtones", 0),
      getParamNumber(fx, "highlights", 0),
    );
  }
  // The effect's amount is −1…1; the shared adjustment speaks Lightroom's
  // −100…100, so one scale converts between them in the single place it matters.
  if (fx.type === "color.vibrance") {
    // The effect's amount is −1…1; the shared adjustment speaks Lightroom's
    // −100…100, so one scale converts between them in the single place it
    // matters.
    return vibrance(image, getParamNumber(fx, "amount", 0) * 100);
  }
  if (fx.type === "light.tone") {
    // Four separate passes rather than one combined formula: each control has
    // its own tonal weighting, and running them in Lightroom's own order keeps
    // the result recognisable to anyone who knows the reference product.
    let out = adjustHighlights(image, getParamNumber(fx, "highlights", 0));
    out = adjustShadows(out, getParamNumber(fx, "shadows", 0));
    out = adjustWhites(out, getParamNumber(fx, "whites", 0));
    return adjustBlacks(out, getParamNumber(fx, "blacks", 0));
  }
  if (fx.type === "color.hsl_mixer") {
    const band = getParamString(fx, "band", "red") as HslBand;
    return colorMixer(image, {
      [band]: {
        hue: getParamNumber(fx, "hue", 0),
        saturation: getParamNumber(fx, "saturation", 0),
        luminance: getParamNumber(fx, "luminance", 0),
      },
    });
  }
  if (fx.type === "color.color_grading") {
    return colorGrading(image, {
      shadows: {
        hue: getParamNumber(fx, "shadowsHue", 220),
        saturation: getParamNumber(fx, "shadowsStrength", 0),
      },
      midtones: {
        hue: getParamNumber(fx, "midtonesHue", 120),
        saturation: getParamNumber(fx, "midtonesStrength", 0),
      },
      highlights: {
        hue: getParamNumber(fx, "highlightsHue", 40),
        saturation: getParamNumber(fx, "highlightsStrength", 0),
      },
      balance: getParamNumber(fx, "balance", 0),
      blend: getParamNumber(fx, "blend", 100),
    });
  }
  if (fx.type === "fx.presence") {
    let out = clarity(image, getParamNumber(fx, "clarity", 0));
    out = texture(out, getParamNumber(fx, "texture", 0));
    return dehaze(out, getParamNumber(fx, "dehaze", 0));
  }
  return noiseReduction(
    image,
    getParamNumber(fx, "luminance", 0),
    getParamNumber(fx, "color", 0),
  );
}

function grade(
  sourceKey: string,
  source: CanvasImageSource,
  width: number,
  height: number,
  gradingFx: EffectInstance[],
  masks: readonly ClipMask[],
): CanvasImageSource {
  if (gradingFx.length === 0) return source;

  const key = `${sourceKey}|${width}x${height}|${gradeSignature(gradingFx)}|${maskSignature(masks, gradingFx)}`;
  const cached = gradeCache.get(key);
  if (cached) return cached;

  const off = gradeUncached(source, width, height, gradingFx, masks);

  // Bounded like artCache: the cache exists for the repeated frames of one
  // export and one slider drag, not for a whole session's history.
  if (gradeCache.size > 12) {
    const oldest = gradeCache.keys().next().value;
    if (oldest !== undefined) gradeCache.delete(oldest);
  }
  gradeCache.set(key, off);
  return off;
}

/**
 * Run a grade with no cache at all.
 *
 * `grade()` keys its cache on the *source*, which works because a clip's media
 * at a given source time is the same picture every time it is asked for. An
 * adjustment layer's source is the live canvas — different pixels on every
 * frame, and often on every repaint of the same frame — so a cache would either
 * return a stale grade or grow without bound. This is that path.
 */
/**
 * Can this stack be collapsed into a 3D table?
 *
 * Only when every effect is pointwise and none is masked — a mask makes the
 * result depend on *where* a pixel is, which is precisely what a colour table
 * cannot encode.
 *
 * Two effects is the floor. One pointwise effect costs a single pass either
 * way, and building a table for it would add ~36k evaluations to save nothing.
 */
function isLutable(
  gradingFx: readonly EffectInstance[],
  masks: readonly ClipMask[],
): boolean {
  if (gradingFx.length < 2) return false;
  if (masks.length > 0 && gradingFx.some((fx) => fx.maskId)) return false;
  return gradingFx.every((fx) => POINTWISE_GRADING_TYPES.has(fx.type));
}

function gradeUncached(
  source: CanvasImageSource,
  width: number,
  height: number,
  gradingFx: EffectInstance[],
  masks: readonly ClipMask[],
): HTMLCanvasElement {
  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  const octx = off.getContext("2d", { willReadFrequently: true })!;
  octx.drawImage(source, 0, 0, width, height);
  const image = octx.getImageData(0, 0, width, height);

  // A pointwise stack costs one pass instead of one per effect: the chain is
  // run once over a 33-cube of colours — about 36k pixels however many effects
  // there are — and every image pixel then costs one interpolated lookup. The
  // table is built by running the very same `gradeImage`, so the two paths
  // cannot drift apart.
  if (isLutable(gradingFx, masks)) {
    let cube = identityCubeImage();
    for (const fx of gradingFx) cube = gradeImage(cube, fx);
    const lut = cubeImageToLut(cube);
    const out = applyLut3d({ width, height, data: image.data }, lut);
    image.data.set(out.data);
    octx.putImageData(image, 0, 0);
    return off;
  }

  let raster: RasterImage = { width, height, data: image.data };
  // One rasterization per mask, however many effects reference it: turning
  // geometry into coverage is the expensive half, and it does not depend on
  // which adjustment is asking.
  const rasterized = new Map<string, ReturnType<typeof rasterizeClipMask>>();
  for (const fx of gradingFx) {
    const adjusted = gradeImage(raster, fx);
    const mask = fx.maskId
      ? masks.find((candidate) => candidate.id === fx.maskId)
      : undefined;
    if (!mask) {
      raster = adjusted;
      continue;
    }
    let coverage = rasterized.get(mask.id);
    if (!coverage) {
      coverage = rasterizeClipMask(mask, raster);
      rasterized.set(mask.id, coverage);
    }
    raster = blendThroughMask(raster, adjusted, coverage);
  }

  image.data.set(raster.data);
  octx.putImageData(image, 0, 0);
  return off;
}

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

/** Decode an audio asset once and cache a fixed-size peak array, then trigger
 * a timeline re-render so its clips draw a real waveform. OfflineAudioContext
 * decodes without needing a user gesture. */
async function ensureWaveform(asset: MediaAsset): Promise<void> {
  if (asset.kind !== "audio") return;
  if (waveformCache.has(asset.id) || waveformPending.has(asset.id)) return;
  waveformPending.add(asset.id);
  try {
    const bytes = await (await fetch(assetUri(asset))).arrayBuffer();
    if (!decodeCtx) decodeCtx = new OfflineAudioContext(1, 1, 44100);
    const buffer = await decodeCtx.decodeAudioData(bytes);
    const data = buffer.getChannelData(0);
    const per = Math.max(1, Math.floor(data.length / WAVEFORM_BUCKETS));
    const peaks: number[] = [];
    for (let b = 0; b < WAVEFORM_BUCKETS; b++) {
      let max = 0;
      const start = b * per;
      for (let i = 0; i < per && start + i < data.length; i++) {
        const v = Math.abs(data[start + i]!);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    waveformCache.set(asset.id, peaks);
    renderTimeline();
  } catch {
    // Undecodable source (or no audio track): leave it without a waveform.
  } finally {
    waveformPending.delete(asset.id);
  }
}

/** Draw the peaks for a clip's trimmed source window onto its canvas. */
function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: number[],
  clip: TimelineClip,
  asset: MediaAsset,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const assetDurUs = Number(asset.metadata.durationUs ?? "0") || 1;
  const inFrac = Number(clip.sourceInUs) / assetDurUs;
  const outFrac = Number(clip.sourceOutUs) / assetDurUs;
  const span = Math.max(0.0001, outFrac - inFrac);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  const mid = h / 2;
  for (let x = 0; x < w; x++) {
    const frac = inFrac + (x / w) * span;
    const peak = peaks[Math.min(peaks.length - 1, Math.floor(frac * peaks.length))] ?? 0;
    const half = Math.max(0.5, peak * (h / 2 - 1));
    ctx.fillRect(x, mid - half, 1, half * 2);
  }
}

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
    const headName = document.createElement("span");
    headName.textContent = `${track.name} (${track.kind})`;
    head.appendChild(headName);

    // Magnetic is a property of the track, so it is toggled where the track is
    // named rather than from a global menu that would have to ask which one.
    const magnet = document.createElement("button");
    magnet.className = "track-magnet";
    magnet.textContent = "🧲";
    magnet.dataset.trackId = track.id;
    const on = track.magnetic === true;
    magnet.setAttribute("aria-pressed", String(on));
    magnet.setAttribute("aria-label", `Magnetic ${track.name}`);
    magnet.title = on
      ? "Magnetic: clips stay packed end to end. Click to allow gaps."
      : "Click to make this track magnetic — gaps close and clips reorder.";
    magnet.addEventListener("click", (event) => {
      event.stopPropagation();
      commit(
        buildSetTrackMagnetic(nextCtx(), {
          sequenceId: SEQUENCE_ID,
          trackId: track.id,
          magnetic: !on,
        }),
      );
    });
    head.appendChild(magnet);
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
      hideDropOverlay();
      const assetId = e.dataTransfer?.getData("application/x-asset-id");
      if (assetId) {
        const asset = findAsset(assetId);
        if (asset) {
          addAssetToTimeline(
            asset.id,
            asset.kind,
            asset.metadata.durationUs ?? "5000000",
            track.id,
            rangeFor(asset),
          );
        }
      } else if (e.dataTransfer?.files.length) {
        void importFiles(e.dataTransfer.files);
      }
    });

    for (const clip of track.clips) {
      const el = document.createElement("div");
      el.className = `clip${track.kind === "audio" ? " audio" : ""}${
        clip.id === selectedClipId || selectedClipIds.has(clip.id)
          ? " selected"
          : ""
      }`;
      // The clip's own span, exposed so a test can assert what a browser range
      // actually produced rather than inferring it from pixel width. The start
      // is here for the same reason: a ripple is a change of position, and
      // reading it off `style.left` would be reading the zoom level back.
      el.dataset.durationUs = clip.timelineDurationUs;
      el.dataset.startUs = clip.timelineStartUs;
      el.style.left = `${usToPixels(clip.timelineStartUs, zoom)}px`;
      const clipWidth = Math.max(24, usToPixels(clip.timelineDurationUs, zoom));
      el.style.width = `${clipWidth}px`;
      const asset = findAsset(clip.assetId);

      // Audio clips draw a real waveform of their trimmed source window
      // behind the label; decoded lazily and cached (see ensureWaveform).
      if (asset && asset.kind === "audio") {
        const peaks = waveformCache.get(asset.id);
        if (peaks) {
          const wf = document.createElement("canvas");
          wf.className = "clip-waveform";
          wf.width = Math.round(clipWidth);
          wf.height = 44;
          drawWaveform(wf, peaks, clip, asset);
          el.appendChild(wf);
        } else {
          void ensureWaveform(asset);
        }
      }

      const label = document.createElement("span");
      label.className = "clip-label";
      label.textContent = asset ? assetName(asset) : clip.id;
      el.appendChild(label);

      for (const localTimeUs of uniqueKeyframeTimes(clip)) {
        const count = (clip.animations ?? []).reduce(
          (total, animation) =>
            total +
            animation.keyframes.filter(
              (keyframe) => keyframe.timeUs === localTimeUs,
            ).length,
          0,
        );
        const marker = document.createElement("button");
        marker.className = "clip-keyframe-marker";
        marker.style.left = `clamp(5px, ${keyframePositionPercent(
          localTimeUs,
          clip.timelineDurationUs,
        )}%, calc(100% - 5px))`;
        marker.title = `${count} keyframe${count === 1 ? "" : "s"} at ${formatTime(localTimeUs)}`;
        marker.setAttribute(
          "aria-label",
          `Go to ${count} keyframe${count === 1 ? "" : "s"} at ${formatTime(localTimeUs)}`,
        );
        marker.addEventListener("pointerdown", (event) =>
          event.stopPropagation(),
        );
        marker.addEventListener("click", (event) => {
          event.stopPropagation();
          selectedClipId = clip.id;
          seekToClipAnimationTime(clip, localTimeUs);
        });
        el.appendChild(marker);
      }

      // Marker pins along the clip's foot: a note is meant to be found again,
      // so it has to be visible on the timeline and not only in a panel.
      for (const marker of clip.markers ?? []) {
        const pin = document.createElement("button");
        pin.className = `clip-marker clip-marker-${marker.kind}${
          marker.done ? " done" : ""
        }`;
        pin.style.left = `clamp(4px, ${keyframePositionPercent(
          marker.timeUs,
          clip.timelineDurationUs,
        )}%, calc(100% - 4px))`;
        pin.textContent =
          marker.kind === "chapter" ? "▮" : marker.kind === "todo" ? "☐" : "●";
        pin.title = `${marker.name} — ${formatTime(marker.timeUs)}`;
        pin.setAttribute(
          "aria-label",
          `Marker ${marker.name} at ${formatTime(marker.timeUs)}`,
        );
        pin.addEventListener("pointerdown", (event) => event.stopPropagation());
        pin.addEventListener("click", (event) => {
          event.stopPropagation();
          selectedClipId = clip.id;
          seekToClipAnimationTime(clip, marker.timeUs);
        });
        el.appendChild(pin);
      }

      const remove = document.createElement("button");
      remove.className = "clip-remove";
      remove.textContent = "✕";
      remove.title = "Remove clip";
      // Swallow pointerdown so it deletes instead of starting a clip drag.
      remove.addEventListener("pointerdown", (e) => e.stopPropagation());
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteClip(clip.id);
      });
      el.appendChild(remove);

      // Trim handles: the outer few pixels of each edge drag the in/out point
      // instead of moving the clip, which is how every NLE behaves.
      for (const side of ["left", "right"] as const) {
        const handle = document.createElement("div");
        handle.className = `clip-trim clip-trim-${side}`;
        handle.title = `Trim ${side === "left" ? "start" : "end"} (hold Shift to ripple)`;
        handle.setAttribute("aria-label", `Trim ${clip.id} ${side}`);
        handle.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          startClipTrim(e, clip, track, side);
        });
        el.appendChild(handle);
      }

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
  const friendly = assetNames.get(asset.id);
  if (friendly) return friendly;
  // originalUri is a blob: URL whose last segment is an opaque UUID — never a
  // useful label. Fall back to a short kind-based name, not the raw UUID.
  return `${asset.kind} clip`;
}

/** Snap tolerance in pixels, converted to time at the current zoom so the
 * magnet feels the same whether the timeline is zoomed in or out. */
const SNAP_TOLERANCE_PX = 8;

function snapToleranceUs(): string {
  return String(Math.round((SNAP_TOLERANCE_PX / zoom) * 1_000_000));
}

/** Drag a clip horizontally to move it (dispatches timeline.move_clip).
 * The drop position snaps to clip edges, the playhead and the sequence start;
 * hold Alt to place it exactly where the pointer is instead. */
function startClipDrag(
  e: PointerEvent,
  clip: TimelineClip,
  track: Track,
): void {
  e.preventDefault();
  if (e.shiftKey || e.metaKey || e.ctrlKey) {
    toggleClipSelection(clip.id);
    return;
  }
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
    if (drag.commandType !== "timeline.move_clip") return;

    const seq = activeSequence();
    const snapped =
      seq && !ev.altKey
        ? snapClipStart(
            drag.payload.timelineStartUs,
            clip.timelineDurationUs,
            collectSnapTargets(seq, [clip.id], playback.currentTimeUs),
            snapToleranceUs(),
          )
        : { startUs: drag.payload.timelineStartUs, snappedTo: null };

    commit(
      buildMoveClip(nextCtx(), {
        ...drag.payload,
        timelineStartUs: snapped.startUs,
      }),
    );
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/**
 * Drag a clip edge to trim it.
 *
 * Trimming the left edge changes the in-point, which shortens the clip from its
 * head; the clip's timeline start is moved by the same amount in the same
 * gesture so the remaining frames stay where they were on the timeline — two
 * commands, one undo step.
 *
 * Holding Shift ripples: every later clip on the track shifts by the change in
 * duration, so the cut after this one keeps its relationship to it.
 */
function startClipTrim(
  e: PointerEvent,
  clip: TimelineClip,
  track: Track,
  side: "left" | "right",
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
      kind: side === "left" ? "trim-left" : "trim-right",
      sequenceId: SEQUENCE_ID,
      clip,
      deltaPixels: ev.clientX - startX,
      pixelsPerSecond: zoom,
    });
    if (drag.commandType !== "timeline.trim_clip") return;

    const newDuration =
      BigInt(drag.payload.sourceOutUs) - BigInt(drag.payload.sourceInUs);
    const ripple = ev.shiftKey
      ? planRippleTrim(track, clip.id, newDuration.toString())
      : { clipId: clip.id, moves: [] };
    const headShift =
      side === "left"
        ? BigInt(drag.payload.sourceInUs) - BigInt(clip.sourceInUs)
        : 0n;

    session.beginGesture();
    if (commit(buildTrimClip(nextCtx(), drag.payload))) {
      if (headShift !== 0n) {
        const start = BigInt(clip.timelineStartUs) + headShift;
        commit(
          buildMoveClip(nextCtx(), {
            sequenceId: SEQUENCE_ID,
            clipId: clip.id,
            targetTrackId: track.id,
            timelineStartUs: (start < 0n ? 0n : start).toString(),
          }),
        );
      }
      for (const move of ripple.moves) {
        commit(
          buildMoveClip(nextCtx(), {
            sequenceId: SEQUENCE_ID,
            clipId: move.clipId,
            targetTrackId: track.id,
            timelineStartUs: move.timelineStartUs,
          }),
        );
      }
    }
    session.endGesture();
    updateUI();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/** Add or remove a clip from the multi-selection (Shift/Cmd-click). */
function toggleClipSelection(clipId: string): void {
  if (selectedClipIds.has(clipId)) {
    selectedClipIds.delete(clipId);
  } else {
    // The clip selected on its own is part of the selection being built.
    if (selectedClipId && selectedClipId !== clipId) {
      selectedClipIds.add(selectedClipId);
    }
    selectedClipIds.add(clipId);
  }
  selectedClipId = clipId;
  updateUI();
}

/** Every clip the next timeline action applies to, in timeline order. */
function selectionClipIds(): string[] {
  const seq = activeSequence();
  if (!seq) return selectedClipId ? [selectedClipId] : [];
  const chosen = new Set(selectedClipIds);
  if (selectedClipId) chosen.add(selectedClipId);
  const ordered: string[] = [];
  for (const track of seq.tracks) {
    for (const clip of [...track.clips].sort(
      (a, b) => Number(BigInt(a.timelineStartUs) - BigInt(b.timelineStartUs)),
    )) {
      if (chosen.has(clip.id)) ordered.push(clip.id);
    }
  }
  return ordered;
}

/**
 * Delete the selection, optionally closing the gaps behind it.
 *
 * A ripple delete is several commands — the delete plus a move per following
 * clip — dispatched inside one gesture, so a single Undo puts the cut back.
 */
function deleteSelection(ripple: boolean): void {
  const clipIds = selectionClipIds();
  if (clipIds.length === 0) return;

  session.beginGesture();
  // Right to left: deleting an earlier clip first would move the later ones
  // out from under the positions this plan was computed for.
  for (const clipId of [...clipIds].reverse()) {
    const loc = locateClip(clipId);
    if (!loc) continue;
    const plan = ripple
      ? planRippleDelete(loc.track, clipId)
      : { deleteClipId: clipId, moves: [] };
    if (!commit(buildDeleteClip(nextCtx(), { sequenceId: SEQUENCE_ID, clipId })))
      continue;
    for (const move of plan.moves) {
      if (clipIds.includes(move.clipId)) continue; // about to be deleted too
      commit(
        buildMoveClip(nextCtx(), {
          sequenceId: SEQUENCE_ID,
          clipId: move.clipId,
          targetTrackId: loc.track.id,
          timelineStartUs: move.timelineStartUs,
        }),
      );
    }
  }
  session.endGesture();

  selectedClipIds.clear();
  selectedClipId = null;
  updateUI();
}

// ==========================================================================
// Inspector rendering
// ==========================================================================

function seekToClipAnimationTime(
  clip: TimelineClip,
  localTimeUs: string,
): void {
  const timelineTimeUs = (
    BigInt(clip.timelineStartUs) + BigInt(localTimeUs)
  ).toString();
  playback = pause(seek(playback, timelineTimeUs));
  syncTransport();
  syncAudioMonitors();
  drawPreview();
  renderTimeline();
  renderInspector();
}

function upsertAnimationKeyframe(
  clip: TimelineClip,
  property: AnimationProperty,
  localTimeUs: string,
  value: number,
  easing: AnimationEasing,
): void {
  const track = clip.animations?.find((item) => item.property === property);
  const exact = exactKeyframeAtTime(clip, property, localTimeUs);
  if (track && exact) {
    commit(
      buildUpdateKeyframe(nextCtx(), {
        sequenceId: SEQUENCE_ID,
        clipId: clip.id,
        animationId: track.id,
        keyframeId: exact.id,
        timeUs: localTimeUs,
        value,
        easing,
      }),
    );
    return;
  }

  commit(
    buildAddKeyframe(nextCtx(), {
      sequenceId: SEQUENCE_ID,
      clipId: clip.id,
      animationId: track?.id ?? crypto.randomUUID(),
      property,
      keyframe: {
        id: crypto.randomUUID(),
        timeUs: localTimeUs,
        value,
        easing,
      },
    }),
  );
}

function toggleAnimationKeyframe(
  clip: TimelineClip,
  spec: AnimationControlSpec,
  localTimeUs: string,
): void {
  const track = clip.animations?.find(
    (item) => item.property === spec.property,
  );
  const exact = exactKeyframeAtTime(clip, spec.property, localTimeUs);
  if (track && exact) {
    commit(
      buildRemoveKeyframe(nextCtx(), {
        sequenceId: SEQUENCE_ID,
        clipId: clip.id,
        animationId: track.id,
        keyframeId: exact.id,
      }),
    );
    return;
  }

  upsertAnimationKeyframe(
    clip,
    spec.property,
    localTimeUs,
    animationValueAtTime(clip, spec.property, localTimeUs),
    "ease-in-out",
  );
}

function animationPropertyControl(
  clip: TimelineClip,
  spec: AnimationControlSpec,
  localTimeUs: string,
): HTMLElement {
  const track = clip.animations?.find(
    (item) => item.property === spec.property,
  );
  const exact = exactKeyframeAtTime(clip, spec.property, localTimeUs);
  const value = animationValueAtTime(clip, spec.property, localTimeUs);
  const wrap = document.createElement("div");
  wrap.className = "animation-control";

  const header = document.createElement("div");
  header.className = "animation-control-header";
  const inputId = `animation-${clip.id}-${spec.property.replaceAll(".", "-")}`;
  const label = document.createElement("label");
  label.htmlFor = inputId;
  label.textContent = spec.label;
  const valueLabel = document.createElement("span");
  valueLabel.className = "animation-value";
  valueLabel.textContent = spec.format(value);
  const diamond = document.createElement("button");
  diamond.type = "button";
  diamond.className = `keyframe-diamond${exact ? " active" : ""}`;
  diamond.textContent = exact ? "◆" : "◇";
  diamond.title = exact ? "Remove keyframe here" : "Add keyframe here";
  diamond.setAttribute("aria-label", diamond.title);
  diamond.setAttribute("aria-pressed", String(exact !== undefined));
  diamond.addEventListener("click", () =>
    toggleAnimationKeyframe(clip, spec, localTimeUs),
  );
  header.append(label, valueLabel, diamond);

  const input = document.createElement("input");
  input.id = inputId;
  input.type = "range";
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(value);
  input.setAttribute("aria-label", `${spec.label} animation value`);
  input.addEventListener("input", () => {
    valueLabel.textContent = spec.format(Number(input.value));
  });
  input.addEventListener("change", () =>
    upsertAnimationKeyframe(
      clip,
      spec.property,
      localTimeUs,
      Number(input.value),
      exact?.easing ?? "ease-in-out",
    ),
  );

  const footer = document.createElement("div");
  footer.className = "animation-control-footer";
  const count = document.createElement("span");
  count.textContent = `${track?.keyframes.length ?? 0} keyframe${track?.keyframes.length === 1 ? "" : "s"}`;
  const easing = document.createElement("select");
  easing.className = "animation-easing";
  easing.setAttribute("aria-label", `${spec.label} keyframe easing`);
  easing.disabled = exact === undefined;
  for (const optionValue of ANIMATION_EASINGS) {
    const option = new Option(optionValue.replaceAll("-", " "), optionValue);
    option.selected = optionValue === (exact?.easing ?? "ease-in-out");
    easing.appendChild(option);
  }
  easing.title = exact
    ? "Easing from this keyframe to the next"
    : "Move onto or add a keyframe to edit easing";
  easing.addEventListener("change", () => {
    if (!exact) return;
    upsertAnimationKeyframe(
      clip,
      spec.property,
      localTimeUs,
      exact.value,
      easing.value as AnimationEasing,
    );
  });
  footer.append(count, easing);
  wrap.append(header, input, footer);
  return wrap;
}

/**
 * The speeds a Speed control offers.
 *
 * Discrete presets rather than a free slider, because the rate is a *reduced*
 * rational — a slider would have to invent a denominator for every position and
 * most of them would be refused by the schema.
 */
const SPEED_PRESETS: ReadonlyArray<{
  label: string;
  rate: { numerator: number; denominator: number };
}> = [
  { label: "0.25×", rate: { numerator: 1, denominator: 4 } },
  { label: "0.5×", rate: { numerator: 1, denominator: 2 } },
  { label: "0.75×", rate: { numerator: 3, denominator: 4 } },
  { label: "1×", rate: { numerator: 1, denominator: 1 } },
  { label: "1.5×", rate: { numerator: 3, denominator: 2 } },
  { label: "2×", rate: { numerator: 2, denominator: 1 } },
  { label: "4×", rate: { numerator: 4, denominator: 1 } },
];

const rateKey = (rate: { numerator: number; denominator: number }): string =>
  `${rate.numerator}/${rate.denominator}`;

/** Blend-mode labels. The values are the schema's own names — the W3C ones —
 * so nothing has to be translated between the picker, the command and the
 * canvas; only the capitalisation is for reading. */
const BLEND_LABELS: Readonly<Record<string, string>> = {
  normal: "Normal",
  multiply: "Multiply",
  screen: "Screen",
  overlay: "Overlay",
  darken: "Darken",
  lighten: "Lighten",
  "color-dodge": "Colour Dodge",
  "color-burn": "Colour Burn",
  "hard-light": "Hard Light",
  "soft-light": "Soft Light",
  difference: "Difference",
  exclusion: "Exclusion",
  hue: "Hue",
  saturation: "Saturation",
  color: "Colour",
  luminosity: "Luminosity",
};

/**
 * How this clip combines with what is beneath it.
 *
 * Only worth showing where there is something to blend with, which is any
 * visual clip: on the lowest track a blend mode composites against the
 * background, which is a real (if quiet) result rather than a no-op.
 */
function blendSection(clip: TimelineClip): HTMLElement {
  const blend = section("Blend");
  const control = document.createElement("div");
  control.className = "control";
  const label = document.createElement("label");
  label.textContent = "Blend mode";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Blend mode");
  const current = clip.blendMode ?? "normal";
  for (const mode of BLEND_MODES) {
    const option = new Option(BLEND_LABELS[mode] ?? mode, mode);
    option.selected = mode === current;
    select.appendChild(option);
  }
  select.addEventListener("change", () => {
    const loc = locateClip(clip.id);
    if (!loc) return;
    commit(
      buildSetClipBlendMode(nextCtx(), {
        sequenceId: SEQUENCE_ID,
        clipId: clip.id,
        blendMode: select.value as (typeof BLEND_MODES)[number],
      }),
    );
    updateUI();
  });
  control.append(label, select);
  blend.appendChild(control);

  const note = document.createElement("p");
  note.className = "hint";
  note.textContent =
    "Multiply darkens, Screen brightens, Overlay does both from the midpoint. " +
    "A clip blends with whatever is composited beneath it, so the result " +
    "depends on the track order.";
  blend.appendChild(note);
  return blend;
}

/**
 * Retiming.
 *
 * Slowing a clip lengthens it in place, which the reducer refuses if the next
 * clip is in the way — so the change is issued as one gesture: retime, then
 * ripple the clips after it. Speeding up ripples too, closing the gap the
 * shorter clip would otherwise leave.
 */
function speedSection(clip: TimelineClip): HTMLElement {
  const speed = section("Speed");
  const control = document.createElement("div");
  control.className = "control";
  const label = document.createElement("label");
  label.textContent = "Clip speed";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Clip speed");
  for (const preset of SPEED_PRESETS) {
    const option = new Option(preset.label, rateKey(preset.rate));
    option.selected = rateKey(preset.rate) === rateKey(clip.playbackRate);
    select.appendChild(option);
  }
  select.addEventListener("change", () => {
    const preset = SPEED_PRESETS.find((p) => rateKey(p.rate) === select.value);
    if (preset) setClipSpeed(clip, preset.rate);
  });
  control.append(label, select);
  speed.appendChild(control);

  // A ramp and a constant rate are two descriptions of one clip's speed, and
  // only one is ever live — so the constant picker is disabled while a ramp is
  // in force, rather than offering a change the reducer would refuse.
  if (clip.speedRamp !== undefined) {
    select.disabled = true;
    select.title = "This clip has a speed ramp; clear it to set one rate";
  }
  speed.appendChild(rampControl(clip));

  const note = document.createElement("p");
  note.className = "hint";
  note.textContent =
    "Retiming keeps the same frames and spreads them over more or less " +
    "timeline. Audio is resampled with the picture, so a slowed clip drops in " +
    "pitch — there is no pitch-preserving stretch yet.";
  speed.appendChild(note);
  return speed;
}

/**
 * The ramp editor: the segments a clip's speed is made of, and a way to add one
 * at the playhead.
 *
 * The playhead is the anchor because it is where you are already looking — you
 * scrub to the moment the action should slow, and say how much. Its *source*
 * position is what the segment records, since that is the coordinate a ramp is
 * written in and it does not move when a later rate changes.
 *
 * Every action rebuilds the whole ramp and issues one command, because the
 * command is whole-ramp: segments only mean anything together.
 */
function rampControl(clip: TimelineClip): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ramp";

  const sourceSpan = BigInt(clip.sourceOutUs) - BigInt(clip.sourceInUs);
  const offsetAtPlayhead =
    sourceAtClipOffset(
      clip,
      BigInt(playback.currentTimeUs) - BigInt(clip.timelineStartUs),
    ) - BigInt(clip.sourceInUs);
  const insideClip =
    BigInt(playback.currentTimeUs) >= BigInt(clip.timelineStartUs) &&
    BigInt(playback.currentTimeUs) <
      BigInt(clip.timelineStartUs) + BigInt(clip.timelineDurationUs);

  const segments = clip.speedRamp ?? [];
  if (segments.length > 0) {
    const list = document.createElement("div");
    list.className = "ramp-list";
    for (const segment of segments) {
      const row = document.createElement("div");
      row.className = "ramp-row";
      row.dataset.offsetUs = segment.sourceOffsetUs;

      const at = document.createElement("span");
      at.className = "ramp-at";
      at.textContent = `from ${formatTime(segment.sourceOffsetUs)}`;

      const rate = document.createElement("select");
      rate.className = "ramp-rate";
      rate.setAttribute(
        "aria-label",
        `Rate from ${formatTime(segment.sourceOffsetUs)}`,
      );
      for (const preset of SPEED_PRESETS) {
        const option = new Option(preset.label, rateKey(preset.rate));
        option.selected = rateKey(preset.rate) === rateKey(segment.rate);
        rate.appendChild(option);
      }
      rate.addEventListener("change", () => {
        const preset = SPEED_PRESETS.find((p) => rateKey(p.rate) === rate.value);
        if (!preset) return;
        setSpeedRamp(
          clip,
          segments.map((s) =>
            s.id === segment.id ? { ...s, rate: preset.rate } : s,
          ),
        );
      });

      const drop = document.createElement("button");
      drop.className = "mini ramp-drop";
      drop.textContent = "✕";
      drop.title = "Remove this speed change";
      drop.setAttribute(
        "aria-label",
        `Remove speed change at ${formatTime(segment.sourceOffsetUs)}`,
      );
      // The first segment is the clip's own opening rate; removing it would
      // leave the span before the next boundary with no rate at all.
      drop.disabled = segment.sourceOffsetUs === "0";
      drop.addEventListener("click", () => {
        const kept = segments.filter((s) => s.id !== segment.id);
        // One segment left is a constant rate, which has its own spelling — the
        // schema refuses a one-segment ramp, so this clears it instead.
        setSpeedRamp(clip, kept.length < 2 ? null : kept);
      });

      row.append(at, rate, drop);
      list.appendChild(row);
    }
    wrap.appendChild(list);
  }

  const actions = document.createElement("div");
  actions.className = "ramp-actions";

  const add = document.createElement("button");
  add.className = "mini";
  add.id = "btn-add-speed-change";
  add.textContent = "＋ Speed change at playhead";
  const already = segments.some(
    (s) => BigInt(s.sourceOffsetUs) === offsetAtPlayhead,
  );
  const usable =
    insideClip && offsetAtPlayhead > 0n && offsetAtPlayhead < sourceSpan;
  add.disabled = !usable || already;
  add.title = already
    ? "There is already a speed change here"
    : usable
      ? "Split the clip's speed here and slow what follows"
      : "Move the playhead inside this clip, past its first frame";
  add.addEventListener("click", () => {
    // A new boundary defaults to half speed: the point of adding one is to
    // change the rate, and 1× would look like nothing happened.
    const half = { numerator: 1, denominator: 2 };
    const base =
      segments.length > 0
        ? segments
        : [{ id: rampSegmentId(), sourceOffsetUs: "0", rate: clip.playbackRate }];
    setSpeedRamp(clip, [
      ...base,
      {
        id: rampSegmentId(),
        sourceOffsetUs: offsetAtPlayhead.toString(),
        rate: half,
      },
    ]);
  });
  actions.appendChild(add);

  if (segments.length > 0) {
    const clear = document.createElement("button");
    clear.className = "mini";
    clear.id = "btn-clear-ramp";
    clear.textContent = "Clear ramp";
    clear.title = "Back to one rate for the whole clip";
    clear.addEventListener("click", () => setSpeedRamp(clip, null));
    actions.appendChild(clear);
  }

  wrap.appendChild(actions);
  return wrap;
}

const rampSegmentId = (): string => `seg-${crypto.randomUUID().slice(0, 8)}`;

/**
 * Set or clear a ramp, rippling the clips after it exactly as a constant
 * retime does — a ramp changes the clip's length for the same reason and the
 * reducer refuses a collision the same way.
 */
function setSpeedRamp(
  clip: TimelineClip,
  ramp: SpeedRamp | null,
): void {
  const loc = locateClip(clip.id);
  if (!loc) return;
  const sourceSpan = BigInt(clip.sourceOutUs) - BigInt(clip.sourceInUs);
  const newDuration =
    ramp === null
      ? sourceSpan
      : BigInt(rampTimelineDurationUs(ramp, clip.sourceInUs, clip.sourceOutUs));
  const ripple = planRippleTrim(loc.track, clip.id, newDuration.toString());

  session.beginGesture();
  const movesFirst = newDuration > BigInt(clip.timelineDurationUs);
  const applyMoves = (): void => {
    for (const move of ripple.moves) {
      commit(
        buildMoveClip(nextCtx(), {
          sequenceId: SEQUENCE_ID,
          clipId: move.clipId,
          targetTrackId: loc.track.id,
          timelineStartUs: move.timelineStartUs,
        }),
      );
    }
  };
  if (movesFirst) applyMoves();
  const ramped = commit(
    buildSetClipSpeedRamp(nextCtx(), {
      sequenceId: SEQUENCE_ID,
      clipId: clip.id,
      ramp,
    }),
  );
  if (ramped && !movesFirst) applyMoves();
  session.endGesture();
  updateUI();
}

function setClipSpeed(
  clip: TimelineClip,
  rate: { numerator: number; denominator: number },
): void {
  const loc = locateClip(clip.id);
  if (!loc) return;
  const sourceSpan = BigInt(clip.sourceOutUs) - BigInt(clip.sourceInUs);
  const newDuration =
    (sourceSpan * BigInt(rate.denominator)) / BigInt(rate.numerator);
  const ripple = planRippleTrim(loc.track, clip.id, newDuration.toString());

  session.beginGesture();
  // Lengthening: the clips after it have to move out of the way first, or the
  // retime is refused as an overlap.
  const movesFirst = newDuration > BigInt(clip.timelineDurationUs);
  const applyMoves = (): void => {
    for (const move of ripple.moves) {
      commit(
        buildMoveClip(nextCtx(), {
          sequenceId: SEQUENCE_ID,
          clipId: move.clipId,
          targetTrackId: loc.track.id,
          timelineStartUs: move.timelineStartUs,
        }),
      );
    }
  };
  if (movesFirst) applyMoves();
  const retimed = commit(
    buildSetClipSpeed(nextCtx(), {
      sequenceId: SEQUENCE_ID,
      clipId: clip.id,
      playbackRate: rate,
    }),
  );
  if (retimed && !movesFirst) applyMoves();
  session.endGesture();
  updateUI();
}

function animationSection(clip: TimelineClip): HTMLElement {
  const animation = section("Animation");
  animation.classList.add("animation-section");
  const localTimeUs = clipLocalTimeForPlayhead(clip, playback.currentTimeUs);
  const times = uniqueKeyframeTimes(clip);
  const previous = adjacentKeyframeTime(times, localTimeUs, -1);
  const next = adjacentKeyframeTime(times, localTimeUs, 1);

  const auto = document.createElement("div");
  auto.className = "animation-auto";
  const autoLabel = document.createElement("label");
  const autoSelectId = `animation-auto-${clip.id}`;
  autoLabel.htmlFor = autoSelectId;
  autoLabel.textContent = "Auto motion";
  const autoRow = document.createElement("div");
  autoRow.className = "animation-auto-row";
  const autoSelect = document.createElement("select");
  autoSelect.id = autoSelectId;
  autoSelect.setAttribute("aria-label", "Auto animation preset");
  for (const preset of ANIMATION_PRESETS) {
    autoSelect.appendChild(new Option(preset.label, preset.id));
  }
  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.className = "mini primary";
  applyButton.textContent = "Apply";
  applyButton.title = "Replace clip animation with this preset";
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "mini";
  clearButton.textContent = "Clear";
  clearButton.title = "Remove all animation from this clip";
  clearButton.disabled = (clip.animations?.length ?? 0) === 0;
  const description = document.createElement("p");
  description.className = "animation-auto-description";
  const updateDescription = (): void => {
    const selected = ANIMATION_PRESETS.find(
      (preset) => preset.id === autoSelect.value,
    );
    description.textContent = `${selected?.description ?? ""} Applying replaces current animation.`;
  };
  autoSelect.addEventListener("change", updateDescription);
  applyButton.addEventListener("click", () => {
    const animations = materializeAnimationPreset(
      autoSelect.value as AnimationPresetId,
      clip.timelineDurationUs,
      () => crypto.randomUUID(),
    );
    if (
      commit(
        buildUpdateClipAnimations(nextCtx(), {
          sequenceId: SEQUENCE_ID,
          clipId: clip.id,
          animations,
        }),
      )
    ) {
      seekToClipAnimationTime(clip, "0");
      toast("Auto animation applied — Undo removes the whole preset");
    }
  });
  clearButton.addEventListener("click", () => {
    if (
      commit(
        buildUpdateClipAnimations(nextCtx(), {
          sequenceId: SEQUENCE_ID,
          clipId: clip.id,
          animations: [],
        }),
      )
    ) {
      toast("Clip animation cleared");
    }
  });
  updateDescription();
  autoRow.append(autoSelect, applyButton, clearButton);
  auto.append(autoLabel, autoRow, description);
  animation.appendChild(auto);

  const navigation = document.createElement("div");
  navigation.className = "animation-nav";
  const previousButton = document.createElement("button");
  previousButton.type = "button";
  previousButton.className = "mini";
  previousButton.textContent = "◀";
  previousButton.title = "Previous keyframe";
  previousButton.setAttribute("aria-label", previousButton.title);
  previousButton.disabled = previous === undefined;
  previousButton.addEventListener("click", () => {
    if (previous !== undefined) seekToClipAnimationTime(clip, previous);
  });
  const time = document.createElement("span");
  time.className = "animation-time";
  time.textContent = `${formatTime(localTimeUs)} local`;
  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "mini";
  nextButton.textContent = "▶";
  nextButton.title = "Next keyframe";
  nextButton.setAttribute("aria-label", nextButton.title);
  nextButton.disabled = next === undefined;
  nextButton.addEventListener("click", () => {
    if (next !== undefined) seekToClipAnimationTime(clip, next);
  });
  navigation.append(previousButton, time, nextButton);
  animation.appendChild(navigation);

  const help = document.createElement("p");
  help.className = "animation-help";
  help.textContent =
    "◇ adds a keyframe at the playhead. Moving a slider also creates or updates one.";
  animation.appendChild(help);
  for (const spec of ANIMATION_CONTROLS) {
    animation.appendChild(animationPropertyControl(clip, spec, localTimeUs));
  }
  return animation;
}

/** Default ramp for a newly added transition: long enough to read, short
 * enough to fit inside any clip the UI lets you add. */
const DEFAULT_TRANSITION_US = "500000";

function commitTransition(
  clip: TimelineClip,
  side: TransitionSide,
  transition: Transition | null,
): void {
  commit(
    buildSetClipTransition(nextCtx(), {
      sequenceId: SEQUENCE_ID,
      clipId: clip.id,
      side,
      transition,
    }),
  );
}

/** One end's controls: kind, duration, easing, and a colour when dipping. */
function transitionEndControl(
  clip: TimelineClip,
  side: TransitionSide,
): HTMLElement {
  const current = side === "in" ? clip.transitionIn : clip.transitionOut;
  const wrap = document.createElement("div");
  wrap.className = "transition-end";

  const header = document.createElement("div");
  header.className = "transition-end-header";
  const label = document.createElement("span");
  label.textContent = side === "in" ? "In" : "Out";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = current ? "mini" : "mini primary";
  toggle.textContent = current ? "Remove" : "Add";
  toggle.title =
    current === undefined
      ? `Add a ${side === "in" ? "an incoming" : "an outgoing"} transition`
      : "Remove this transition";
  toggle.addEventListener("click", () => {
    if (current !== undefined) {
      commitTransition(clip, side, null);
      return;
    }
    // Never propose a ramp that cannot fit: the reducer would reject it.
    const other =
      side === "in" ? clip.transitionOut?.durationUs : clip.transitionIn?.durationUs;
    const room = BigInt(clip.timelineDurationUs) - BigInt(other ?? "0");
    const durationUs =
      room < BigInt(DEFAULT_TRANSITION_US) ? room.toString() : DEFAULT_TRANSITION_US;
    if (room <= 0n) {
      toast("No room left on this clip for another transition.", true);
      return;
    }
    commitTransition(clip, side, {
      id: crypto.randomUUID(),
      kind: "cross",
      durationUs,
      easing: "ease-in-out",
    });
  });
  header.append(label, toggle);
  wrap.appendChild(header);

  if (current === undefined) return wrap;

  const row = document.createElement("div");
  row.className = "transition-row";

  const KIND_LABELS: Record<TransitionKind, string> = {
    cross: "Crossfade",
    dip: "Dip to colour",
    slide: "Slide",
  };
  const kind = document.createElement("select");
  kind.setAttribute("aria-label", `${side} transition kind`);
  for (const value of TRANSITION_KINDS) {
    kind.appendChild(new Option(KIND_LABELS[value], value));
  }
  kind.value = current.kind;
  kind.addEventListener("change", () => {
    const nextKind = kind.value as TransitionKind;
    commitTransition(clip, side, {
      id: current.id,
      kind: nextKind,
      durationUs: current.durationUs,
      easing: current.easing,
      // The schema pairs each extra field with exactly one kind, so carry over
      // only the one that belongs to the kind being switched to.
      ...(nextKind === "dip"
        ? { colorHex: current.colorHex ?? "#000000" }
        : {}),
      ...(nextKind === "slide"
        ? { direction: current.direction ?? "left" }
        : {}),
    });
  });

  const duration = document.createElement("input");
  duration.type = "range";
  duration.min = "50";
  duration.max = String(
    Math.max(
      50,
      Math.floor(
        Number(
          BigInt(clip.timelineDurationUs) -
            BigInt(
              (side === "in" ? clip.transitionOut : clip.transitionIn)
                ?.durationUs ?? "0",
            ),
        ) / 1000,
      ),
    ),
  );
  duration.step = "10";
  duration.value = String(Math.round(Number(current.durationUs) / 1000));
  duration.setAttribute("aria-label", `${side} transition duration`);
  const durationLabel = document.createElement("span");
  durationLabel.className = "transition-duration";
  durationLabel.textContent = `${duration.value} ms`;
  duration.addEventListener("input", () => {
    durationLabel.textContent = `${duration.value} ms`;
  });
  duration.addEventListener("change", () => {
    commitTransition(clip, side, {
      ...current,
      durationUs: String(Number(duration.value) * 1000),
    });
  });

  const easing = document.createElement("select");
  easing.setAttribute("aria-label", `${side} transition easing`);
  for (const value of ANIMATION_EASINGS) {
    easing.appendChild(new Option(value, value));
  }
  easing.value = current.easing;
  easing.addEventListener("change", () => {
    commitTransition(clip, side, {
      ...current,
      easing: easing.value as AnimationEasing,
    });
  });

  row.append(kind, duration, durationLabel, easing);

  if (current.kind === "dip") {
    const colour = document.createElement("input");
    colour.type = "color";
    colour.value = current.colorHex ?? "#000000";
    colour.setAttribute("aria-label", `${side} dip colour`);
    colour.addEventListener("change", () => {
      commitTransition(clip, side, { ...current, colorHex: colour.value });
    });
    row.appendChild(colour);
  }

  if (current.kind === "slide") {
    const direction = document.createElement("select");
    direction.setAttribute("aria-label", `${side} slide direction`);
    for (const value of TRANSITION_DIRECTIONS) {
      direction.appendChild(new Option(value, value));
    }
    direction.value = current.direction ?? "left";
    direction.title =
      side === "in"
        ? "Edge the clip enters from"
        : "Edge the clip exits toward";
    direction.addEventListener("change", () => {
      commitTransition(clip, side, {
        ...current,
        direction: direction.value as TransitionDirection,
      });
    });
    row.appendChild(direction);
  }

  wrap.appendChild(row);
  return wrap;
}

function transitionSection(clip: TimelineClip): HTMLElement {
  const el = section("Transitions");
  el.classList.add("transition-section");
  el.appendChild(transitionEndControl(clip, "in"));
  el.appendChild(transitionEndControl(clip, "out"));

  const help = document.createElement("p");
  help.className = "animation-help";
  help.textContent =
    "A crossfade blends with whatever is underneath — a lower track, or the previous clip once you slide this one back over it. A dip ramps against its own colour.";
  el.appendChild(help);
  return el;
}

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

  // With several clips selected the palette and Looks cover all of them while
  // these panels still edit one. Saying so is the difference between a feature
  // and a surprise.
  const selectionCount = selectionClipIds().length;
  if (selectionCount > 1) {
    const banner = document.createElement("p");
    banner.className = "hint";
    banner.id = "selection-hint";
    banner.textContent =
      `${selectionCount} clips selected. Effects and Looks apply to all of ` +
      `them; the controls below edit ${asset ? assetName(asset) : clip.id}.`;
    inspectorEl.appendChild(banner);
  }

  if (mode === "photo" && asset?.kind === "image") {
    const aiBtn = document.createElement("button");
    aiBtn.className = "tool primary";
    aiBtn.style.width = "100%";
    aiBtn.style.marginBottom = "8px";
    aiBtn.textContent = "🧠 AI Remove Background (one click)";
    aiBtn.title =
      "Real U²-Net segmentation running locally — the same model rembg uses. Best for photos with a busy or textured background.";
    aiBtn.addEventListener("click", () => void quickAiRemoveBackground(clip.id));
    inspectorEl.appendChild(aiBtn);

    const editBtn = document.createElement("button");
    editBtn.className = "tool";
    editBtn.style.width = "100%";
    editBtn.style.marginBottom = "12px";
    editBtn.textContent = "🖌 Edit Photo (Brush, Crop, Clone, AI…)";
    editBtn.addEventListener("click", () => enterRasterMode(clip.id));
    inspectorEl.appendChild(editBtn);
  }
  if (mode === "video" && asset?.kind === "video") {
    const editFrameBtn = document.createElement("button");
    editFrameBtn.className = "tool primary";
    editFrameBtn.style.width = "100%";
    editFrameBtn.style.marginBottom = "12px";
    editFrameBtn.textContent = "🎞 Edit Current Frame (Brush, Clone, Wand…)";
    editFrameBtn.addEventListener("click", () => {
      void enterRasterModeFromVideoFrame(clip.id).catch((err: unknown) => {
        toast(
          `Could not read that frame: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      });
    });
    inspectorEl.appendChild(editFrameBtn);
  }

  if (asset && asset.kind !== "audio") {
    inspectorEl.appendChild(animationSection(clip));
    inspectorEl.appendChild(transitionSection(clip));
  }

  inspectorEl.appendChild(markersSection(clip));
  if (asset && asset.kind !== "audio") {
    inspectorEl.appendChild(blendSection(clip));
  }
  inspectorEl.appendChild(speedSection(clip));
  if (asset && asset.kind !== "audio") {
    inspectorEl.appendChild(masksSection(clip));
  }

  // --- Effects (visual only; audio effects live in the Audio section) ---
  const fxSection = section("Effects");
  appendEffectRows(
    fxSection,
    clip,
    clip.effects.filter((fx) => !isAudioEffectType(fx.type)),
  );
  fxSection.appendChild(
    addEffectSelect(
      "＋ Add effect…",
      visualEffects().filter((s) => s.modes.includes(effectMode())),
    ),
  );
  inspectorEl.appendChild(fxSection);

  // --- Audio (only for clips that actually carry audio) ---
  if (asset?.kind === "image") return;
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
  // Fades, EQ and the compressor are effects like any other — validated,
  // undoable, reorderable — they just belong beside gain and pan rather than
  // beside blur.
  appendEffectRows(
    audioSection,
    clip,
    clip.effects.filter((fx) => isAudioEffectType(fx.type)),
  );
  audioSection.appendChild(
    addEffectSelect("＋ Add audio effect…", audioEffects()),
  );
  inspectorEl.appendChild(audioSection);
}

/**
 * Markers: notes pinned to moments of the clip.
 *
 * They change nothing about the render, so the section is a list rather than a
 * panel of controls: jump to one, rename it, tick a to-do, delete it.
 */
function markersSection(clip: TimelineClip): HTMLElement {
  const section_ = section("Markers");
  const markers = clip.markers ?? [];

  for (const marker of markers) {
    const row = document.createElement("div");
    row.className = "effect-row marker-row";

    const jump = document.createElement("button");
    jump.className = "mini marker-jump";
    jump.textContent = formatTime(marker.timeUs);
    jump.title = "Move the playhead to this marker";
    jump.setAttribute("aria-label", `Go to ${marker.name}`);
    jump.addEventListener("click", () =>
      seekToClipAnimationTime(clip, marker.timeUs),
    );

    const name = document.createElement("input");
    name.className = "marker-name";
    name.value = marker.name;
    name.setAttribute("aria-label", `Marker name at ${formatTime(marker.timeUs)}`);
    // On change, not on input: a command per keystroke would bury the log and
    // make one undo per character.
    name.addEventListener("change", () => {
      if (name.value.trim() === "") {
        name.value = marker.name;
        return;
      }
      commit(
        buildUpdateMarker(nextCtx(), {
          sequenceId: SEQUENCE_ID,
          clipId: clip.id,
          markerId: marker.id,
          name: name.value.trim(),
        }),
      );
    });

    const remove = document.createElement("button");
    remove.className = "mini";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${marker.name}`);
    remove.addEventListener("click", () =>
      commit(
        buildRemoveMarker(nextCtx(), {
          sequenceId: SEQUENCE_ID,
          clipId: clip.id,
          markerId: marker.id,
        }),
      ),
    );

    if (marker.kind === "todo") {
      const done = document.createElement("input");
      done.type = "checkbox";
      done.checked = marker.done === true;
      done.setAttribute("aria-label", `${marker.name} done`);
      done.addEventListener("change", () =>
        commit(
          buildUpdateMarker(nextCtx(), {
            sequenceId: SEQUENCE_ID,
            clipId: clip.id,
            markerId: marker.id,
            done: done.checked,
          }),
        ),
      );
      row.append(done);
    }
    row.append(jump, name, remove);
    section_.appendChild(row);
  }

  const addWrap = document.createElement("div");
  addWrap.className = "control";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Add marker");
  select.appendChild(new Option("＋ Add marker at playhead…", ""));
  for (const [value, label] of [
    ["standard", "Note"],
    ["chapter", "Chapter"],
    ["todo", "To-do"],
  ] as const) {
    select.appendChild(new Option(label, value));
  }
  select.addEventListener("change", () => {
    if (select.value) addMarkerAtPlayhead(select.value as MarkerKind);
  });
  addWrap.appendChild(select);
  section_.appendChild(addWrap);

  if (markers.length === 0) {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent =
      "Markers ride the clip: trimming or moving it carries them along. Press M to drop one at the playhead.";
    section_.appendChild(hint);
  }
  return section_;
}

/**
 * Add a marker to the selected clip at the playhead.
 *
 * The playhead can sit outside the selected clip, and a marker's time is
 * clip-local — so the caller is told where it landed rather than being handed a
 * validation error from the reducer.
 */
function addMarkerAtPlayhead(kind: MarkerKind = "standard"): void {
  const loc = locateClip(selectedClipId);
  if (!loc) {
    toast("Select a clip first, then add a marker.", true);
    return;
  }
  const { clip } = loc;
  const local = BigInt(playback.currentTimeUs) - BigInt(clip.timelineStartUs);
  if (local < 0n || local >= BigInt(clip.timelineDurationUs)) {
    toast("Move the playhead over the selected clip to mark it.", true);
    return;
  }
  const count = (clip.markers ?? []).length + 1;
  const name =
    kind === "chapter"
      ? `Chapter ${count}`
      : kind === "todo"
        ? `To-do ${count}`
        : `Marker ${count}`;
  if (
    commit(
      buildAddMarker(nextCtx(), {
        sequenceId: SEQUENCE_ID,
        clipId: clip.id,
        marker: {
          id: `marker-${crypto.randomUUID().slice(0, 8)}`,
          timeUs: local.toString(),
          name,
          kind,
        },
      }),
    )
  ) {
    toast(`${name} added at ${formatTime(local.toString())}.`);
  }
}

/**
 * The Masks section: the regions themselves, independent of any effect.
 *
 * A mask is created whole — one contribution, sensible defaults — and then
 * adjusted, because the alternative is an empty mask the schema refuses. New
 * masks land centred at a comfortable size rather than filling the frame, so
 * the difference between masked and unmasked is visible the moment one is
 * attached to an effect.
 */
const MASK_PRESETS: ReadonlyArray<{
  label: string;
  build: (id: string) => MaskContribution;
}> = [
  {
    label: "Radial",
    build: (id) => ({
      id,
      kind: "radial",
      mode: "add",
      centre: { x: 0.5, y: 0.5 },
      radius: { x: 0.35, y: 0.35 },
      feather: 0.5,
      invert: false,
    }),
  },
  {
    label: "Linear",
    build: (id) => ({
      id,
      kind: "linear",
      mode: "add",
      from: { x: 0, y: 0 },
      to: { x: 0, y: 1 },
    }),
  },
  {
    label: "Luminance range",
    build: (id) => ({
      id,
      kind: "luminance_range",
      mode: "add",
      min: 0.5,
      max: 1,
      feather: 0.15,
    }),
  },
  {
    label: "Colour range",
    build: (id) => ({
      id,
      kind: "color_range",
      mode: "add",
      colorHex: "#ff5a00",
      tolerance: 0.25,
      feather: 0.1,
    }),
  },
];

function masksSection(clip: TimelineClip): HTMLElement {
  const section_ = section("Masks");
  const masks = clip.masks ?? [];

  for (const mask of masks) {
    const header = document.createElement("div");
    header.className = "effect-row";
    const name = document.createElement("span");
    name.className = "fx-name";
    name.textContent = maskLabel(mask);
    const remove = document.createElement("button");
    remove.className = "mini";
    remove.textContent = "Remove";
    remove.title = "Delete this mask (detach it from any effect first)";
    remove.addEventListener("click", () =>
      commit(
        buildRemoveMask(nextCtx(), {
          sequenceId: SEQUENCE_ID,
          clipId: clip.id,
          maskId: mask.id,
        }),
      ),
    );
    header.append(name, remove);
    section_.appendChild(header);

    for (const control of maskControls(clip, mask)) {
      section_.appendChild(control);
    }
  }

  const addWrap = document.createElement("div");
  addWrap.className = "control";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Add mask");
  select.appendChild(new Option("＋ Add mask…", ""));
  for (const preset of MASK_PRESETS) {
    select.appendChild(new Option(preset.label, preset.label));
  }
  select.addEventListener("change", () => {
    const preset = MASK_PRESETS.find((m) => m.label === select.value);
    if (!preset) return;
    const maskId = `mask-${masks.length + 1}-${Date.now().toString(36)}`;
    commit(
      buildAddMask(nextCtx(), {
        sequenceId: SEQUENCE_ID,
        clipId: clip.id,
        mask: {
          id: maskId,
          name: preset.label,
          contributions: [preset.build(`${maskId}-c1`)],
        },
      }),
    );
  });
  addWrap.appendChild(select);
  section_.appendChild(addWrap);

  const note = document.createElement("p");
  note.className = "hint";
  note.textContent =
    "A mask is a region, not an edit. Attach one to any effect with the " +
    "effect's Mask control; several effects can share the same mask.";
  section_.appendChild(note);
  return section_;
}

/** Sliders for a mask's first contribution — enough to place and shape it. */
function maskControls(clip: TimelineClip, mask: ClipMask): HTMLElement[] {
  const contribution = mask.contributions[0];
  if (!contribution) return [];

  const push = (patch: Partial<MaskContribution>): void => {
    commit(
      buildUpdateMask(nextCtx(), {
        sequenceId: SEQUENCE_ID,
        clipId: clip.id,
        maskId: mask.id,
        contributions: [
          { ...contribution, ...patch } as MaskContribution,
          ...mask.contributions.slice(1),
        ],
      }),
    );
  };
  const slider = (
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    onChange: (v: number) => void,
  ): HTMLElement => sliderControl(`${label}`, min, max, step, value, onChange);

  if (contribution.kind === "radial") {
    return [
      slider("Centre across", 0, 1, 0.01, contribution.centre.x, (v) =>
        push({ centre: { ...contribution.centre, x: v } }),
      ),
      slider("Centre down", 0, 1, 0.01, contribution.centre.y, (v) =>
        push({ centre: { ...contribution.centre, y: v } }),
      ),
      slider("Width", 0.02, 1, 0.01, contribution.radius.x, (v) =>
        push({ radius: { ...contribution.radius, x: v } }),
      ),
      slider("Height", 0.02, 1, 0.01, contribution.radius.y, (v) =>
        push({ radius: { ...contribution.radius, y: v } }),
      ),
      slider("Feather", 0, 1, 0.05, contribution.feather, (v) =>
        push({ feather: v }),
      ),
      toggleControl("Invert", contribution.invert, (on) =>
        push({ invert: on }),
      ),
    ];
  }
  if (contribution.kind === "linear") {
    return [
      slider("From across", 0, 1, 0.01, contribution.from.x, (v) =>
        push({ from: { ...contribution.from, x: v } }),
      ),
      slider("From down", 0, 1, 0.01, contribution.from.y, (v) =>
        push({ from: { ...contribution.from, y: v } }),
      ),
      slider("To across", 0, 1, 0.01, contribution.to.x, (v) =>
        push({ to: { ...contribution.to, x: v } }),
      ),
      slider("To down", 0, 1, 0.01, contribution.to.y, (v) =>
        push({ to: { ...contribution.to, y: v } }),
      ),
    ];
  }
  if (contribution.kind === "luminance_range") {
    return [
      slider("Darkest", 0, 1, 0.01, contribution.min, (v) =>
        push({ min: Math.min(v, contribution.max - 0.01) }),
      ),
      slider("Brightest", 0, 1, 0.01, contribution.max, (v) =>
        push({ max: Math.max(v, contribution.min + 0.01) }),
      ),
      slider("Feather", 0, 0.5, 0.01, contribution.feather, (v) =>
        push({ feather: v }),
      ),
    ];
  }
  if (contribution.kind === "color_range") {
    return [
      colorControl("Colour", contribution.colorHex, (hex) =>
        push({ colorHex: hex }),
      ),
      slider("Tolerance", 0, 1, 0.01, contribution.tolerance, (v) =>
        push({ tolerance: v }),
      ),
      slider("Feather", 0, 0.5, 0.01, contribution.feather, (v) =>
        push({ feather: v }),
      ),
    ];
  }
  // A brush stroke is authored by painting, not by sliders; only its shape
  // controls make sense here.
  return [
    slider("Brush size", 0.01, 1, 0.01, contribution.radius, (v) =>
      push({ radius: v }),
    ),
    slider("Feather", 0, 1, 0.05, contribution.feather, (v) =>
      push({ feather: v }),
    ),
  ];
}

function toggleControl(
  label: string,
  value: boolean,
  onChange: (on: boolean) => void,
): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "control";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = value;
  box.setAttribute("aria-label", label);
  box.addEventListener("change", () => onChange(box.checked));
  wrap.append(` ${label} `, box);
  return wrap;
}

function colorControl(
  label: string,
  value: string,
  onChange: (hex: string) => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "control";
  const text = document.createElement("label");
  text.textContent = label;
  const input = document.createElement("input");
  input.type = "color";
  input.value = value;
  input.setAttribute("aria-label", label);
  input.addEventListener("change", () => onChange(input.value));
  wrap.append(text, input);
  return wrap;
}

/** One header + parameter block per effect, with a Remove button. */
function appendEffectRows(
  container: HTMLElement,
  clip: TimelineClip,
  effects: readonly EffectInstance[],
): void {
  for (const fx of effects) {
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
    container.appendChild(header);

    // A curve has no scalar parameters to slide — it is edited by dragging its
    // points — so this type renders its own control instead of a param list.
    if (fx.type === "color.curves") {
      container.appendChild(curveEditor(clip, fx));
    } else if (spec) {
      for (const p of spec.params) {
        container.appendChild(paramControl(clip.id, fx, spec, p));
      }
    }
    // Masking is a property of the *reference*, not of the effect's params, so
    // the picker sits with the effect while the region itself lives in Masks.
    if (spec?.surface !== "audio" && (clip.masks ?? []).length > 0) {
      container.appendChild(maskPicker(clip, fx));
    }
  }
}

/** Which of the clip's masks confines this effect, if any. */
function maskPicker(clip: TimelineClip, fx: EffectInstance): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "control";
  const label = document.createElement("label");
  label.textContent = "Mask";
  const select = document.createElement("select");
  select.setAttribute("aria-label", `${fx.type} mask`);
  const none = new Option("Whole frame", "");
  none.selected = fx.maskId === undefined;
  select.appendChild(none);
  for (const mask of clip.masks ?? []) {
    const option = new Option(maskLabel(mask), mask.id);
    option.selected = mask.id === fx.maskId;
    select.appendChild(option);
  }
  select.addEventListener("change", () =>
    commit(
      buildSetEffectMask(nextCtx(), {
        sequenceId: SEQUENCE_ID,
        clipId: clip.id,
        effectId: fx.id,
        maskId: select.value === "" ? null : select.value,
      }),
    ),
  );
  wrap.append(label, select);
  return wrap;
}

const maskLabel = (mask: ClipMask): string =>
  mask.name ?? `Mask (${mask.contributions.length})`;

function addEffectSelect(
  placeholderLabel: string,
  specs: readonly EffectSpec[],
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "control";
  const select = document.createElement("select");
  select.setAttribute("aria-label", placeholderLabel.replace("＋ ", ""));
  select.appendChild(new Option(placeholderLabel, ""));
  for (const spec of specs) {
    select.appendChild(new Option(spec.label, spec.type));
  }
  select.addEventListener("change", () => {
    if (select.value) addEffectByType(select.value as EffectType);
  });
  wrap.appendChild(select);
  return wrap;
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
  if (p.kind === "text") {
    const wrap = document.createElement("div");
    wrap.className = "control control-text";
    const label = document.createElement("label");
    const inputId = `fx-text-${fx.id}`;
    label.htmlFor = inputId;
    label.textContent = p.label;
    const input = document.createElement("textarea");
    input.id = inputId;
    input.rows = 2;
    input.value = getParamString(fx, p.name, String(p.def));
    input.placeholder = "Type a caption…";
    // Commit on change, not on input: every keystroke would be its own
    // command, burying the operation log and making one undo per character.
    input.addEventListener("change", () => update(input.value));
    wrap.append(label, input);
    return wrap;
  }
  if (p.kind === "choice") {
    const wrap = document.createElement("div");
    wrap.className = "control";
    const label = document.createElement("label");
    label.textContent = p.label;
    const select = document.createElement("select");
    select.setAttribute("aria-label", `${spec.label} ${p.label}`);
    const current = getParamString(fx, p.name, String(p.def));
    for (const choice of p.choices ?? []) {
      const option = new Option(
        choice.charAt(0).toUpperCase() + choice.slice(1),
        choice,
      );
      option.selected = choice === current;
      select.appendChild(option);
    }
    select.addEventListener("change", () => update(select.value));
    wrap.append(label, select);
    return wrap;
  }
  if (p.kind === "seconds") {
    // Slider in seconds, stored as canonical microseconds: rounded to whole
    // microseconds so the value the command carries is exactly what the
    // schema accepts, with no float residue.
    const storedUs = getParamString(fx, p.name, String(p.def));
    return sliderControl(
      p.label,
      p.min ?? 0,
      p.max ?? 10,
      p.step ?? 0.1,
      Number(storedUs) / 1_000_000,
      (value) => update(String(Math.round(value * 1_000_000))),
    );
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
  // The visible text sits in a sibling span, so the slider itself would
  // otherwise reach assistive tech (and a test runner) with no name at all.
  input.setAttribute("aria-label", label);
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
/** A command type as a person would name the action. Unlisted types fall back
 * to their own name, tidied — a new command shows up readably rather than not
 * at all, which is what a lookup with no fallback would do. */
const HISTORY_LABELS: Readonly<Record<string, string>> = {
  "asset.register": "Import media",
  "asset.set_rating": "Rate media",
  "asset.set_keywords": "Set keywords",
  "asset.add_keyword_range": "Keyword a range",
  "asset.update_keyword_range": "Change a keyword range",
  "asset.remove_keyword_range": "Remove a keyword range",
  "timeline.create_sequence": "Create sequence",
  "timeline.add_track": "Add track",
  "timeline.add_clip": "Add clip",
  "timeline.insert_clip": "Insert clip",
  "timeline.overwrite_clip": "Overwrite clip",
  "timeline.move_clip": "Move clip",
  "timeline.trim_clip": "Trim clip",
  "timeline.delete_clip": "Delete clip",
  "timeline.add_effect": "Add effect",
  "timeline.update_effect_params": "Adjust effect",
  "timeline.remove_effect": "Remove effect",
  "timeline.reorder_effects": "Reorder effects",
  "timeline.update_clip_effects": "Change effects",
  "timeline.set_clip_audio_gain": "Set gain",
  "timeline.set_clip_audio_pan": "Set pan",
  "timeline.set_clip_blend_mode": "Set blend mode",
  "timeline.set_clip_speed": "Set speed",
  "timeline.set_clip_speed_ramp": "Set speed ramp",
  "timeline.add_marker": "Add marker",
  "timeline.update_marker": "Change marker",
  "timeline.remove_marker": "Remove marker",
  "timeline.add_mask": "Add mask",
  "timeline.update_mask": "Change mask",
  "timeline.remove_mask": "Remove mask",
  "timeline.set_effect_mask": "Mask an effect",
  "timeline.add_keyframe": "Add keyframe",
  "timeline.update_keyframe": "Change keyframe",
  "timeline.remove_keyframe": "Remove keyframe",
  "timeline.update_clip_animations": "Change animation",
  "timeline.set_clip_transition": "Set transition",
};

function historyLabel(commandType: string): string {
  const known = HISTORY_LABELS[commandType];
  if (known) return known;
  const tail = commandType.split(".").pop() ?? commandType;
  const words = tail.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One entry in the panel: a whole gesture, named after what it did. */
interface HistoryStep {
  label: string;
  /** The gesture's first command type. Exposed as a data attribute so a test
   * can assert *which* command ran without depending on the wording of a label
   * meant for people — the two changed together once, and every check that read
   * the panel broke at the same time. */
  commandType: string;
  /** Steps before the cursor are done; the rest are on the redo branch. */
  done: boolean;
}

/**
 * The history as a list of steps and a cursor within it.
 *
 * A step is a *gesture*, not an operation: ripple delete is a delete plus a
 * move per clip after it, and adding an adjustment layer is a track, a move per
 * clip, an asset and a clip. Listing those separately would describe the engine
 * rather than what the person did — and would not match Undo, which already
 * steps by gesture.
 *
 * A gesture is named after its *first* command. That is the one the person
 * asked for; the rest are consequences of it.
 */
function historySteps(): HistoryStep[] {
  const state = session.getState();
  const log = state.operationLog;
  const steps: HistoryStep[] = [];

  let at = session.getBaseline();
  for (const size of session.undoStepSizes()) {
    const first = log[at];
    const type = first?.command.commandType ?? "";
    steps.push({
      label: type ? historyLabel(type) : "Edit",
      commandType: type,
      done: true,
    });
    at += size;
  }

  // The redo branch, nearest first. Its operations are held in reverse order —
  // the next to be redone is on top of the stack — so the run for a step is
  // read backwards from the end.
  const redo = state.redoStack;
  let remaining = redo.length;
  for (const size of session.redoStepSizes()) {
    const first = redo[remaining - size];
    const type = first?.command.commandType ?? "";
    steps.push({
      label: type ? historyLabel(type) : "Edit",
      commandType: type,
      done: false,
    });
    remaining -= size;
  }
  return steps;
}

/**
 * Move the present to a given step by stepping Undo or Redo until it is there.
 *
 * Deliberately not a jump: replaying to an arbitrary point would be a second
 * way of moving through history, and the two could disagree. Stepping reuses
 * exactly the path Undo and Redo already take, so a click on an entry lands
 * where pressing Undo that many times would.
 */
function goToHistoryStep(target: number): void {
  const guard = session.undoStepSizes().length + session.redoStepSizes().length;
  for (let i = 0; i <= guard; i += 1) {
    const done = session.undoStepSizes().length;
    if (done === target) break;
    if (done > target) {
      if (!session.undo()) break;
    } else if (!session.redo()) break;
  }
  updateUI();
}

function renderHistory(): void {
  historyEl.innerHTML = "";
  const steps = historySteps();
  if (steps.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "Edits appear here. Click one to go back to it.";
    historyEl.appendChild(empty);
    return;
  }

  const cursor = session.undoStepSizes().length;
  steps.forEach((step, index) => {
    const el = document.createElement("button");
    // `current` marks the step the project is standing on, which is the last
    // done one — not the last in the list, which is what the old panel assumed
    // and which was wrong the moment anything was undone.
    const isCurrent = index === cursor - 1;
    el.className = `history-item${isCurrent ? " current" : ""}${step.done ? "" : " undone"}`;
    el.textContent = `${index + 1}. ${step.label}`;
    el.dataset.commandType = step.commandType;
    el.setAttribute("aria-current", isCurrent ? "step" : "false");
    el.title = step.done
      ? "Go back to just after this edit"
      : "Redo forward to this edit";
    // Clicking entry N means "leave N done", so the target is index + 1.
    el.addEventListener("click", () => goToHistoryStep(index + 1));
    historyEl.appendChild(el);
  });
}

/**
 * The clips an "apply" action covers, and why some are skipped.
 *
 * Adding an effect applies to the whole selection, not only the inspected clip:
 * grading a shoot one clip at a time is the tedium a multi-selection exists to
 * remove. Audio effects skip image clips — an EQ on a still would validate and
 * then sit there inert, which reads as a bug rather than as a no-op.
 */
function applyTargets(spec: EffectSpec): string[] {
  const ids = selectionClipIds();
  if (spec.surface !== "audio") return ids;
  return ids.filter((clipId) => {
    const loc = locateClip(clipId);
    const asset = loc ? findAsset(loc.clip.assetId) : undefined;
    return asset !== undefined && asset.kind !== "image";
  });
}

/** Report what an apply did, naming the count only when it was more than one. */
function reportApplied(label: string, count: number, skipped: number): void {
  if (count === 0) {
    toast(`${label} applies to clips that carry audio.`, true);
    return;
  }
  const scope = count === 1 ? "" : ` to ${count} clips`;
  const note = skipped > 0 ? ` (${skipped} skipped)` : "";
  toast(`Added ${label}${scope}${note}. Adjust it in the Inspector →`);
}

function addEffectByType(type: EffectType): void {
  const spec = effectSpec(type);
  if (!spec) return;
  if (selectionClipIds().length === 0) {
    toast("Select a clip on the timeline first, then add an effect.", true);
    return;
  }
  const targets = applyTargets(spec);
  const skipped = selectionClipIds().length - targets.length;

  // One gesture, however many clips: a single Undo takes the whole apply back.
  session.beginGesture();
  let added = 0;
  for (const clipId of targets) {
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
          clipId,
          effect,
        }),
      )
    ) {
      added++;
    }
  }
  session.endGesture();
  updateUI();
  reportApplied(spec.label, added, skipped);
}

function renderEffectsPalette(): void {
  paletteEl.innerHTML = "";
  for (const spec of visualEffects().filter((s) =>
    s.modes.includes(effectMode()),
  )) {
    const chip = document.createElement("button");
    chip.className = "fx-chip";
    chip.textContent = spec.label;
    const count = selectionClipIds().length;
    chip.disabled = count === 0;
    chip.title =
      count === 0
        ? "Select a clip first"
        : count === 1
          ? `Add ${spec.label} to the selected clip`
          : `Add ${spec.label} to ${count} selected clips`;
    chip.addEventListener("click", () => addEffectByType(spec.type));
    paletteEl.appendChild(chip);
  }
}

// One-click "looks": named stacks of effects. Reimplemented from scratch — a
// standard photo-editor feature (Odysseus lists "presets"), not copied.
interface Look {
  name: string;
  stack: { type: EffectType; params: Record<string, number | string | boolean> }[];
}
const LOOKS: Look[] = [
  {
    name: "Vivid",
    stack: [
      { type: "color.saturate", params: { amount: 1.6 } },
      { type: "color.contrast", params: { amount: 1.2 } },
      { type: "color.brightness", params: { amount: 0.05 } },
    ],
  },
  {
    name: "B&W",
    stack: [
      { type: "color.grayscale", params: { amount: 1 } },
      { type: "color.contrast", params: { amount: 1.2 } },
    ],
  },
  {
    name: "Warm",
    stack: [
      { type: "color.tint", params: { colorHex: "#ff7a2a", amount: 0.25 } },
      { type: "color.saturate", params: { amount: 1.15 } },
      { type: "color.brightness", params: { amount: 0.04 } },
    ],
  },
  {
    name: "Cinematic",
    stack: [
      { type: "color.contrast", params: { amount: 1.3 } },
      { type: "color.saturate", params: { amount: 1.1 } },
      { type: "color.tint", params: { colorHex: "#12b3c9", amount: 0.12 } },
      { type: "color.vignette", params: { amount: 0.55 } },
    ],
  },
  {
    name: "Fade",
    stack: [
      { type: "color.contrast", params: { amount: 0.82 } },
      { type: "color.brightness", params: { amount: 0.12 } },
      { type: "color.saturate", params: { amount: 0.82 } },
    ],
  },
];

function applyLook(look: Look): void {
  const targets = selectionClipIds();
  if (targets.length === 0) {
    toast("Select a clip first, then pick a Look.", true);
    return;
  }

  // A Look is several effects across possibly several clips — one gesture, so
  // one Undo removes the look rather than peeling it off an effect at a time.
  session.beginGesture();
  let clipsTouched = 0;
  for (const clipId of targets) {
    let addedHere = 0;
    for (const layer of look.stack) {
      const spec = effectSpec(layer.type);
      if (!spec) continue;
      const effect = {
        id: `fx-${crypto.randomUUID().slice(0, 8)}`,
        type: layer.type,
        enabled: true,
        params: { ...defaultParams(spec), ...layer.params },
      } as unknown as EffectInstance;
      if (
        commit(
          buildAddEffect(nextCtx(), {
            sequenceId: SEQUENCE_ID,
            clipId,
            effect,
          }),
        )
      ) {
        addedHere++;
      }
    }
    if (addedHere > 0) clipsTouched++;
  }
  session.endGesture();
  updateUI();
  if (clipsTouched > 0) {
    const scope = clipsTouched === 1 ? "" : ` to ${clipsTouched} clips`;
    toast(`Applied "${look.name}"${scope}. Undo or tweak in the Inspector.`);
  }
}

function renderLooks(): void {
  looksRow.innerHTML = "";
  for (const look of LOOKS) {
    const chip = document.createElement("button");
    chip.className = "look-chip";
    chip.textContent = look.name;
    const count = selectionClipIds().length;
    chip.disabled = count === 0;
    chip.title =
      count === 0
        ? "Select a clip first"
        : count === 1
          ? `Apply the ${look.name} look to the selected clip`
          : `Apply the ${look.name} look to ${count} selected clips`;
    chip.addEventListener("click", () => applyLook(look));
    looksRow.appendChild(chip);
  }
}

function renderVectorShapes(): void {
  vectorShapesEl.innerHTML = "";

  const fillRow = document.createElement("div");
  fillRow.className = "vector-fill-row";
  const fillLabel = document.createElement("label");
  fillLabel.htmlFor = "vector-fill";
  fillLabel.textContent = "Fill";
  const fill = document.createElement("input");
  fill.type = "color";
  fill.id = "vector-fill";
  fill.value = vectorFillOverride ?? VECTOR_SHAPE_PRESETS[0]!.fillHex;
  fill.title = "Colour for the next cartoon clip";
  fill.addEventListener("input", () => {
    vectorFillOverride = fill.value;
    renderVectorShapes();
  });
  fillRow.append(fillLabel, fill);
  if (vectorFillOverride !== null) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "mini";
    reset.textContent = "Preset colours";
    reset.title = "Go back to each shape's own colour";
    reset.addEventListener("click", () => {
      vectorFillOverride = null;
      renderVectorShapes();
    });
    fillRow.appendChild(reset);
  }
  vectorShapesEl.appendChild(fillRow);

  for (const preset of VECTOR_SHAPE_PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vector-shape-chip";
    button.title = `Add an animatable ${preset.label} cartoon clip`;
    button.setAttribute("aria-label", button.title);
    const symbol = document.createElement("span");
    symbol.className = "vector-shape-symbol";
    symbol.textContent = preset.symbol;
    symbol.style.setProperty(
      "--shape-fill",
      vectorFillOverride ?? preset.fillHex,
    );
    const label = document.createElement("span");
    label.textContent = preset.label;
    button.append(symbol, label);
    button.addEventListener("click", () => void addVectorShape(preset));
    vectorShapesEl.appendChild(button);
  }
}

/** Does this asset survive the current search text and rating filter? */
function matchesMediaFilters(asset: MediaAsset): boolean {
  const query = mediaSearch.trim().toLowerCase();
  // Search covers keywords as well as the name: typing "interview" should find
  // the shots tagged that way, not only a file that happens to be called it.
  // Range keywords count the same — a shot with an interview *in* it is a shot
  // someone searching for "interview" is looking for.
  if (
    query &&
    !assetName(asset).toLowerCase().includes(query) &&
    !(asset.keywords ?? []).some((keyword) => keyword.includes(query)) &&
    !rangeKeywords(asset).some((keyword) => keyword.includes(query))
  ) {
    return false;
  }
  if (
    mediaKeyword &&
    !(asset.keywords ?? []).includes(mediaKeyword) &&
    !rangeKeywords(asset).includes(mediaKeyword)
  ) {
    return false;
  }
  if (mediaFilter === "favorites") return asset.rating === "favorite";
  if (mediaFilter === "rejected") return asset.rating === "rejected";
  if (mediaFilter === "unrated") return asset.rating === undefined;
  return true;
}

/**
 * Edit an asset's keywords.
 *
 * A prompt rather than a panel: keywords are typed rarely and read often, and a
 * comma-separated line is how people already think of them. Normalization
 * happens here, at the boundary, because the schema refuses anything else —
 * a command that rewrote its own payload would not replay to its own bytes.
 */
function editKeywords(asset: MediaAsset): void {
  const current = (asset.keywords ?? []).join(", ");
  const entered = window.prompt(
    `Keywords for ${assetName(asset)} (comma separated)`,
    current,
  );
  if (entered === null) return;

  const seen = new Set<string>();
  for (const part of entered.split(",")) {
    const keyword = normalizeKeyword(part);
    if (keyword) seen.add(keyword);
  }
  commit(
    buildSetAssetKeywords(nextCtx(), {
      assetId: asset.id,
      keywords: [...seen].sort(),
    }),
  );
}

/**
 * Tag a span of an asset with one keyword, saved with the project.
 *
 * A prompt for the same reason `editKeywords` uses one, and normalization at
 * the same boundary: the schema refuses an unnormalized keyword rather than
 * fixing it, so "Good Take" has to become "good take" here or the command is
 * rejected.
 *
 * The bounds come from the slider pair, already clamped to the asset and
 * already at least a millisecond apart, so the reducer's OUT_OF_BOUNDS and the
 * schema's empty-range rule should both be unreachable from this path — they
 * still exist for the MCP surface and for anything a future UI does.
 */
function keywordCurrentRange(
  asset: MediaAsset,
  startUs: number,
  endUs: number,
): void {
  const entered = window.prompt(
    `Keyword for ${formatTime(String(startUs))} – ${formatTime(String(endUs))} of ${assetName(asset)}`,
    "",
  );
  if (entered === null) return;
  const keyword = normalizeKeyword(entered);
  if (!keyword) {
    toast("That is not a keyword.");
    return;
  }
  const ok = commit(
    buildAddKeywordRange(nextCtx(), {
      assetId: asset.id,
      range: {
        id: `range-${crypto.randomUUID().slice(0, 8)}`,
        keyword,
        startUs: String(startUs),
        endUs: String(endUs),
      },
    }),
  );
  if (ok) toast(`Tagged "${keyword}" over that range.`);
}

/** Every keyword used by a range on this asset, deduplicated — what the chips
 * and the filters read. */
function rangeKeywords(asset: MediaAsset): string[] {
  return [...new Set((asset.keywordRanges ?? []).map((r) => r.keyword))];
}

/**
 * The in/out editor for one media item.
 *
 * Sliders rather than a scrubbing preview: the bin is a list, and a second
 * video element per item to scrub would cost far more than the choice is worth.
 * The pair is kept ordered — dragging In past Out pushes Out along — because a
 * reversed range is not a state worth being able to express.
 */
function openRangeEditor(asset: MediaAsset, item: HTMLElement): void {
  const existing = item.querySelector(".media-range-editor");
  if (existing) {
    existing.remove();
    return;
  }

  const totalUs = Number(asset.metadata.durationUs ?? "0");
  const current = rangeFor(asset);
  let inUs = Number(current.inUs);
  let outUs = Number(current.outUs);

  const editor = document.createElement("div");
  editor.className = "media-range-editor";
  editor.addEventListener("click", (event) => event.stopPropagation());

  const readout = document.createElement("div");
  readout.className = "media-range-readout";
  const refresh = (): void => {
    readout.textContent = `${formatTime(String(Math.round(inUs)))} – ${formatTime(
      String(Math.round(outUs)),
    )}  ·  ${formatTime(String(Math.round(outUs - inUs)))} long`;
  };

  const slider = (
    label: string,
    value: number,
    onInput: (value: number) => void,
  ): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = "media-range-row";
    const text = document.createElement("span");
    text.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = String(totalUs);
    // A microsecond step would make the slider a thousand times finer than any
    // pointer; a millisecond is already below a frame at 60fps.
    input.step = "1000";
    input.value = String(value);
    input.setAttribute("aria-label", `${label} for ${assetName(asset)}`);
    input.addEventListener("input", () => {
      onInput(Number(input.value));
      refresh();
    });
    wrap.append(text, input);
    return wrap;
  };

  // At least one millisecond of picture: an empty range is not a selection.
  const MIN_SPAN_US = 1000;
  const inRow = slider("In", inUs, (value) => {
    inUs = Math.min(value, outUs - MIN_SPAN_US);
    const control = inRow.querySelector("input")!;
    control.value = String(inUs);
  });
  const outRow = slider("Out", outUs, (value) => {
    outUs = Math.max(value, inUs + MIN_SPAN_US);
    const control = outRow.querySelector("input")!;
    control.value = String(outUs);
  });

  const actions = document.createElement("div");
  actions.className = "media-range-actions";
  const apply = document.createElement("button");
  apply.className = "mini";
  apply.textContent = "Use range";
  apply.addEventListener("click", () => {
    browserRanges.set(asset.id, {
      inUs: String(Math.round(inUs)),
      outUs: String(Math.round(outUs)),
    });
    renderMedia();
    toast(
      `Range set: ${formatTime(String(Math.round(outUs - inUs)))} of ${assetName(asset)}.`,
    );
  });
  const clear = document.createElement("button");
  clear.className = "mini";
  clear.textContent = "Whole clip";
  clear.addEventListener("click", () => {
    browserRanges.delete(asset.id);
    renderMedia();
  });

  // Keywording the span happens here rather than in its own editor: the
  // transient range and the persisted one are the same gesture — "this bit,
  // right here" — and the sliders are already open and already pointed at it.
  const keywordIt = document.createElement("button");
  keywordIt.className = "mini";
  keywordIt.textContent = "Keyword this range";
  keywordIt.title = "Tag this part of the shot, saved with the project";
  keywordIt.addEventListener("click", () => {
    keywordCurrentRange(asset, Math.round(inUs), Math.round(outUs));
  });
  actions.append(apply, clear, keywordIt);

  refresh();
  editor.append(readout, inRow, outRow, actions);
  item.appendChild(editor);
}

/** Every keyword in the project, for the filter list. Range keywords are in
 * here too: the picker lists what the project actually has, and a keyword that
 * only ever named a range is still one of them. */
function allKeywords(): string[] {
  const seen = new Set<string>();
  for (const asset of session.getProject()?.assets ?? []) {
    if (removedAssets.has(asset.id)) continue;
    for (const keyword of asset.keywords ?? []) seen.add(keyword);
    for (const keyword of rangeKeywords(asset)) seen.add(keyword);
  }
  return [...seen].sort();
}

/** One rating button. `aria-pressed` carries the state, so the control reads
 * correctly to a screen reader and to a test without a class-name convention. */
function ratingButton(
  asset: MediaAsset,
  rating: "favorite" | "rejected",
  glyph: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  const label = rating === "favorite" ? "Favorite" : "Reject";
  button.type = "button";
  button.textContent = glyph;
  button.title = `${label} ${assetName(asset)}`;
  button.setAttribute("aria-label", `${label} ${assetName(asset)}`);
  button.setAttribute("aria-pressed", String(asset.rating === rating));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    // Clicking the rating it already has clears it: one control, two states,
    // and no separate "unrate" button to find.
    commit(
      buildSetAssetRating(nextCtx(), {
        assetId: asset.id,
        rating: asset.rating === rating ? null : rating,
      }),
    );
  });
  return button;
}

/** Fill the saved-view picker from storage. */
function renderSavedViews(): void {
  const select = $<HTMLSelectElement>("media-view");
  const views = loadSavedViews();
  select.innerHTML = "";
  select.appendChild(new Option("Saved views…", ""));
  for (const view of views) select.appendChild(new Option(view.name, view.name));
  select.disabled = views.length === 0;
}

function renderMedia(): void {
  mediaListEl.innerHTML = "";
  mediaListEl.classList.toggle("grid", galleryGrid);
  const visible = (session.getProject()?.assets ?? []).filter(
    (asset) =>
      !removedAssets.has(asset.id) &&
      // An adjustment layer is created on the timeline, not imported, and there
      // is nothing to preview, rate, keyword or add from here. A compound
      // clip's asset is a pointer to a sequence, for the same reason.
      asset.kind !== "adjustment" &&
      asset.kind !== "sequence" &&
      matchesMediaFilters(asset),
  );
  const anyMedia = (session.getProject()?.assets ?? []).some(
    (asset) => !removedAssets.has(asset.id),
  );
  // Two different empties: nothing imported yet, and nothing matching — saying
  // "no media" while three clips sit behind a filter would look like data loss.
  // The keyword filter lists what the project actually has; a keyword that no
  // longer exists on any asset must not linger as a selectable dead end.
  const keywordSelect = $<HTMLSelectElement>("media-keyword");
  const keywords = allKeywords();
  if (mediaKeyword && !keywords.includes(mediaKeyword)) mediaKeyword = "";
  keywordSelect.innerHTML = "";
  keywordSelect.appendChild(new Option("Any keyword", ""));
  for (const keyword of keywords) {
    const option = new Option(keyword, keyword);
    option.selected = keyword === mediaKeyword;
    keywordSelect.appendChild(option);
  }

  // Offline media: the project remembers them, this session cannot see their
  // bytes. Saying so beside a Relink button beats a bin of blank thumbnails.
  const offline = offlineAssets();
  const relinkBar = $("media-relink");
  relinkBar.classList.toggle("hidden", offline.length === 0);
  if (offline.length > 0) {
    $("media-relink-text").textContent = `${offline.length} file${
      offline.length === 1 ? "" : "s"
    } missing`;
  }

  mediaEmptyEl.classList.toggle("hidden", visible.length > 0);
  mediaEmptyEl.textContent = anyMedia
    ? "No media matches this search or filter."
    : "No media imported yet.";

  for (const asset of visible) {
    const el = document.createElement("div");
    const isOffline = !mediaCache.has(assetUri(asset));
    el.className = `media-item${asset.rating === "rejected" ? " rejected" : ""}${
      isOffline ? " offline" : ""
    }`;
    // The registered digest, exposed so a test can compare it with the file on
    // disk — the one property of streamed hashing that has to stay true.
    el.dataset.checksum = asset.checksum;
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("application/x-asset-id", asset.id);
      e.dataTransfer?.setData("text/plain", asset.id);
    });
    const thumb = document.createElement("div");
    thumb.className = "media-thumb";
    if (
      asset.kind === "image" ||
      asset.kind === "video" ||
      asset.kind === "generated"
    ) {
      thumb.style.backgroundImage = `url("${assetUri(asset)}")`;
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
    sub.textContent = isOffline
      ? `${asset.kind} · missing — click Relink`
      : `${asset.kind} · ${formatTime(asset.metadata.durationUs ?? "0")}`;
    meta.append(name, sub);
    // Which copy this asset is being edited against, said plainly: a soft
    // preview with no explanation is the usual complaint about proxies.
    const building = proxyBuilding.get(asset.id);
    const proxyUrl = proxyUris.get(asset.id);
    if (building !== undefined) {
      const badge = document.createElement("span");
      badge.className = "media-badge building";
      badge.textContent = `Proxy ${Math.round(building * 100)}%`;
      sub.append(badge);
    } else if (proxyUrl) {
      const proxyMedia = mediaCache.get(proxyUrl);
      const height =
        proxyMedia instanceof HTMLVideoElement && proxyMedia.videoHeight
          ? proxyMedia.videoHeight
          : proxySize(asset.metadata.width ?? 0, asset.metadata.height ?? 0)
              .height;
      const badge = document.createElement("span");
      badge.className = "media-badge";
      badge.textContent = `Proxy ${height}p`;
      badge.title = useProxies
        ? "Editing against a proxy; exports use the original."
        : "Proxy built, but proxies are switched off.";
      el.dataset.proxyHeight = String(height);
      sub.append(badge);
    }
    const add = document.createElement("span");
    add.className = "media-add";
    add.textContent = "＋";
    add.title = "Add to timeline";
    const remove = document.createElement("button");
    remove.className = "media-remove";
    remove.textContent = "✕";
    remove.title = "Remove from project";
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      removeAsset(asset.id);
    });
    if ((asset.keywords ?? []).length > 0) {
      const chips = document.createElement("div");
      chips.className = "media-keywords";
      for (const keyword of asset.keywords ?? []) {
        const chip = document.createElement("button");
        chip.className = "media-keyword-chip";
        chip.textContent = keyword;
        chip.title = `Filter by "${keyword}" — click again to clear`;
        chip.setAttribute("aria-label", `Filter by keyword ${keyword}`);
        chip.addEventListener("click", (event) => {
          event.stopPropagation();
          mediaKeyword = mediaKeyword === keyword ? "" : keyword;
          $<HTMLSelectElement>("media-keyword").value = mediaKeyword;
          renderMedia();
        });
        chips.appendChild(chip);
      }
      meta.appendChild(chips);
    }

    // Keyword ranges: the parts of this shot someone has already named.
    //
    // Clicking one *loads it as the browser range* rather than filtering by it,
    // which is the whole point of having tagged it — "the good take" becomes
    // the next thing added, in one click. Filtering by a range keyword is what
    // the picker and the search box are for, and both now reach these.
    let rangeRow: HTMLElement | null = null;
    if ((asset.keywordRanges ?? []).length > 0) {
      const ranges = document.createElement("div");
      ranges.className = "media-ranges";
      for (const kr of asset.keywordRanges ?? []) {
        const chip = document.createElement("span");
        chip.className = "media-range-chip";
        chip.dataset.rangeId = kr.id;
        chip.dataset.startUs = kr.startUs;
        chip.dataset.endUs = kr.endUs;

        const use = document.createElement("button");
        use.className = "media-range-use";
        use.textContent = `${kr.keyword} ${formatTime(kr.startUs)}–${formatTime(kr.endUs)}`;
        // The label truncates in a narrow bin, so the title carries it whole.
        use.title = `${kr.keyword}  ${formatTime(kr.startUs)}–${formatTime(kr.endUs)} — use this range for the next add`;
        use.setAttribute(
          "aria-label",
          `Use keyword range ${kr.keyword} of ${assetName(asset)}`,
        );
        use.addEventListener("click", (event) => {
          event.stopPropagation();
          browserRanges.set(asset.id, { inUs: kr.startUs, outUs: kr.endUs });
          renderMedia();
          toast(`Range set from "${kr.keyword}".`);
        });

        const drop = document.createElement("button");
        drop.className = "media-range-drop";
        drop.textContent = "✕";
        drop.title = `Remove the "${kr.keyword}" range`;
        drop.setAttribute(
          "aria-label",
          `Remove keyword range ${kr.keyword} from ${assetName(asset)}`,
        );
        drop.addEventListener("click", (event) => {
          event.stopPropagation();
          commit(
            buildRemoveKeywordRange(nextCtx(), {
              assetId: asset.id,
              rangeId: kr.id,
            }),
          );
        });

        chip.append(use, drop);
        ranges.appendChild(chip);
      }
      // Appended to the item, not to `meta`: the meta column is about 54px in a
      // 264px sidebar, which truncates "good take" to "good ta…". The chips get
      // their own full-width row instead, the same escape the range editor
      // below already makes.
      rangeRow = ranges;
    }

    // The row's buttons live in one group: three loose flex children were
    // enough to squeeze the name down to "mot…" in a narrow sidebar.
    const actions = document.createElement("div");
    actions.className = "media-actions";

    // Range editor: two sliders over the asset's own duration. Only for media
    // that has a duration worth trimming — a still has nothing to choose.
    const duration = BigInt(asset.metadata.durationUs ?? "0");
    if (asset.kind !== "image" && duration > 0n) {
      const range = rangeFor(asset);
      const chosen = browserRanges.has(asset.id);
      if (chosen) {
        const label = document.createElement("span");
        label.className = "media-range-label";
        label.textContent = `▶ ${formatTime(range.inUs)} – ${formatTime(range.outUs)}`;
        label.title = "This part will be added to the timeline";
        meta.appendChild(label);
      }

      const rangeBtn = document.createElement("button");
      rangeBtn.className = "media-action media-range-btn";
      rangeBtn.textContent = "⟦⟧";
      rangeBtn.title = chosen
        ? "Edit the range that will be added"
        : "Choose the part to add";
      rangeBtn.setAttribute("aria-label", `Range for ${assetName(asset)}`);
      rangeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        openRangeEditor(asset, el);
      });
      actions.appendChild(rangeBtn);
    }

    const tag = document.createElement("button");
    tag.className = "media-action media-tag";
    tag.textContent = "🏷";
    tag.title = "Keywords";
    tag.setAttribute("aria-label", `Keywords for ${assetName(asset)}`);
    tag.addEventListener("click", (event) => {
      event.stopPropagation();
      editKeywords(asset);
    });

    const rating = document.createElement("div");
    rating.className = "media-rating";
    rating.append(
      ratingButton(asset, "favorite", "★"),
      ratingButton(asset, "rejected", "✕"),
    );
    actions.append(tag, remove);
    el.append(thumb, meta, add, actions, rating);
    if (rangeRow) el.appendChild(rangeRow);
    el.addEventListener("click", () =>
      addAssetToTimeline(
        asset.id,
        asset.kind,
        asset.metadata.durationUs ?? "5000000",
        undefined,
        rangeFor(asset),
      ),
    );
    mediaListEl.appendChild(el);
  }
}

/** Remove a media item from the bin and delete any timeline clips that used
 * it. There is no public asset-removal command (only its internal inverse),
 * so the bin entry is hidden client-side while the clip deletions go through
 * the command engine (undoable). */
function removeAsset(assetId: string): void {
  const seq = activeSequence();
  const clipIds: string[] = [];
  for (const track of seq?.tracks ?? []) {
    for (const clip of track.clips) {
      if (clip.assetId === assetId) clipIds.push(clip.id);
    }
  }
  for (const id of clipIds) {
    commit(buildDeleteClip(nextCtx(), { sequenceId: SEQUENCE_ID, clipId: id }));
  }
  removedAssets.add(assetId);
  updateUI();
  toast("Removed from project.");
}

// ==========================================================================
// Saving and opening a project
// ==========================================================================

/**
 * Media hints for the save file: enough to find each file again.
 *
 * Adjustment layers are left out. A hint exists so a missing file can be
 * relinked by checksum, and an adjustment layer has no file — listing one would
 * put an entry in the save that could never be matched to anything, and would
 * show up in the bin's missing-media list on every reopen.
 */
function mediaHints(): MediaHint[] {
  return (session.getProject()?.assets ?? [])
    .filter((asset) => !removedAssets.has(asset.id))
    // flatMap rather than filter-then-map: the ternary narrows `kind` to the
    // kinds a hint can carry, which a filter predicate does not.
    .flatMap((asset) =>
      asset.kind === "adjustment" || asset.kind === "sequence"
        ? []
        : [
            {
              assetId: asset.id,
              name: assetName(asset),
              checksum: asset.checksum,
              fileSizeBytes: asset.metadata.fileSizeBytes,
              kind: asset.kind,
            },
          ],
    );
}

function currentProjectText(): string {
  return serializeProjectFile(
    buildProjectFile(
      session.getState().operationLog,
      mediaHints(),
      new Date().toISOString(),
      session.getBaseline(),
    ),
  );
}

/** The file this project is open from, if any. Set by saving or opening
 * through a picker; a project opened from the plain file input has no handle,
 * because that API hands over bytes and nothing to write back to. */
let currentProjectHandle: FileSystemFileHandle | null = null;

/**
 * Save the project.
 *
 * Silent when there is a file to save to: an editor that asks where to put the
 * project on every Cmd+S is asking a question it already knows the answer to.
 * `saveAs` forces the picker, and a project with no handle — or one whose
 * permission has lapsed — falls through to it.
 *
 * Saving clears the crash snapshot: the user now has something better than a
 * recovery offer, and offering it afterwards would be offering something older.
 */
async function saveProject(saveAs = false): Promise<void> {
  if (!session.getProject()) {
    toast("Nothing to save yet — import some media first.", true);
    return;
  }
  const text = currentProjectText();

  let handle = saveAs ? null : currentProjectHandle;
  if (handle && !(await ensurePermission(handle, "readwrite"))) handle = null;
  if (!handle) handle = await pickExportFile("project.json");

  try {
    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      currentProjectHandle = handle;
      await rememberProject(handle);
      await renderRecentProjects();
    } else {
      // No File System Access API, or the picker was dismissed: a download is
      // still a save, it just cannot be written to again.
      downloadBlob(
        new Blob([text], { type: "application/json" }),
        "project.json",
      );
    }
    projectDirty = false;
    await clearSnapshot();
    toast(handle ? `Saved to ${handle.name}.` : "Project saved.");
  } catch (error) {
    toast(
      `Could not save the project: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
}

/** Fill the recent-projects picker. */
async function renderRecentProjects(): Promise<void> {
  const select = $<HTMLSelectElement>("recent-projects");
  const recents = await listRecent();
  select.innerHTML = "";
  select.appendChild(new Option("Recent…", ""));
  for (const entry of recents) select.appendChild(new Option(entry.name, entry.name));
  select.disabled = recents.length === 0;
}

/**
 * Open a project from the recent list.
 *
 * The stored handle survives a restart but its permission does not, so this
 * asks. A handle whose file has been moved or deleted is dropped from the list
 * rather than left to fail the same way tomorrow.
 */
async function openRecentProject(name: string): Promise<void> {
  const entry = (await listRecent()).find((candidate) => candidate.name === name);
  if (!entry) return;
  if (!(await ensurePermission(entry.handle, "read"))) {
    toast(`Permission to read ${name} was declined.`, true);
    return;
  }
  try {
    const file = await entry.handle.getFile();
    await openProjectFile(file);
    currentProjectHandle = entry.handle;
    await rememberProject(entry.handle);
    await renderRecentProjects();
  } catch {
    await forgetProject(name);
    await renderRecentProjects();
    toast(`${name} could not be opened — it may have been moved or deleted.`, true);
  }
}

/**
 * Open a saved project.
 *
 * The operation log is replayed through the engine rather than trusted as
 * state: a file that has been edited by hand, or written by a different build,
 * fails here rather than half-loading into something that cannot be exported.
 */
async function openProjectFile(file: File): Promise<void> {
  const parsed = parseProjectFile(await file.text());
  if (!parsed.ok) {
    toast(parsed.error, true);
    return;
  }

  const replayed = session.replaceWithOperationLog(
    parsed.file.operations,
    parsed.file.baseline,
  );
  if (!replayed.ok) {
    toast(`That project could not be replayed: ${replayed.error}`, true);
    return;
  }

  // Media from the previous session is gone with its blob URLs; the hints say
  // what to look for.
  currentProjectHandle = null;
  for (const url of proxyUris.values()) {
    mediaCache.delete(url);
    URL.revokeObjectURL(url);
  }
  proxyUris.clear();
  relinkedUris.clear();
  mediaCache.clear();
  removedAssets.clear();
  assetNames.clear();
  for (const hint of parsed.file.media) assetNames.set(hint.assetId, hint.name);
  pendingRelinkHints = parsed.file.media;

  selectedClipId = null;
  selectedClipIds.clear();
  browserRanges.clear();
  playback = seek(playback, "0");
  projectDirty = false;
  await clearSnapshot();
  updateUI();

  const missing = offlineAssets().length;
  toast(
    missing === 0
      ? "Project opened."
      : `Project opened. ${missing} media file${missing === 1 ? "" : "s"} need relinking — click Relink.`,
  );
}

let pendingRelinkHints: MediaHint[] = [];

/**
 * Relink offered files to the assets that are waiting for them.
 *
 * Checksums are computed for what the user picked, so a renamed file still
 * matches: the same bytes are the same media. A name-and-size match is accepted
 * too, and reported as a guess rather than treated as proof.
 */
async function relinkFiles(files: FileList | File[]): Promise<void> {
  const chosen = Array.from(files);
  if (chosen.length === 0) return;

  const candidates = [];
  for (const file of chosen) {
    candidates.push({
      name: file.name,
      fileSizeBytes: String(file.size),
      checksum: await checksumFile(file),
    });
  }

  const hints = pendingRelinkHints.length > 0 ? pendingRelinkHints : mediaHints();
  const plan = planRelink(hints, candidates);
  let guessed = 0;
  for (const match of plan.matches) {
    const file = chosen[match.candidateIndex]!;
    const asset = findAsset(match.assetId);
    if (!asset) continue;
    const url = URL.createObjectURL(file);
    relinkedUris.set(asset.id, url);
    assetNames.set(asset.id, file.name);
    await attachMediaElement(asset, url, file);
    if (match.confidence === "name-and-size") guessed++;
  }

  updateUI();
  const still = offlineAssets().length;
  toast(
    `Relinked ${plan.matches.length} file${plan.matches.length === 1 ? "" : "s"}` +
      (guessed > 0 ? ` (${guessed} matched by name and size, not checksum)` : "") +
      (still > 0 ? ` — ${still} still missing.` : "."),
  );
}

/** Load a relinked file into the media cache the renderer reads from. */
async function attachMediaElement(
  asset: MediaAsset,
  url: string,
  file: File,
): Promise<void> {
  if (asset.kind === "image" || asset.kind === "generated") {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => undefined);
    mediaCache.set(url, image);
    return;
  }
  const element = document.createElement(
    asset.kind === "audio" ? "audio" : "video",
  ) as HTMLVideoElement | HTMLAudioElement;
  element.src = url;
  element.muted = true;
  element.preload = asset.kind === "video" ? "auto" : "metadata";
  await new Promise<void>((resolve) => {
    element.onloadedmetadata = () => resolve();
    element.onerror = () => resolve();
  });
  if (element instanceof HTMLVideoElement) attachOffscreen(element);
  mediaCache.set(url, element as HTMLVideoElement);
  // A proxy is keyed by the source's checksum, so relinking a file that was
  // proxied in an earlier session picks the small copy straight back up
  // instead of transcoding it again.
  if (element instanceof HTMLVideoElement) {
    const built = await readProxy(asset.checksum);
    if (built) attachProxy(asset.id, built);
  }
  void file;
}

/** Whether anything has changed since the last save or open. */
let projectDirty = false;
let autosaveTimer: number | null = null;

/**
 * Snapshot the project periodically while it is dirty.
 *
 * On an interval rather than on every command: a busy drag is dozens of
 * commands a second, and writing the whole log each time would spend more time
 * serialising than editing.
 */
function startAutosave(): void {
  if (autosaveTimer !== null) return;
  autosaveTimer = window.setInterval(() => {
    if (!projectDirty || !session.getProject()) return;
    projectDirty = false;
    void writeSnapshot(currentProjectText()).catch(() => {
      // Storage can be full or blocked; a failed snapshot must never interrupt
      // the edit that triggered it.
    });
  }, 15_000);
}

/** Offer the last crash snapshot, if there is one. */
async function offerRecovery(): Promise<void> {
  const snapshot = await readSnapshot().catch(() => null);
  if (!snapshot) return;
  const bar = $("recovery-bar");
  $("recovery-text").textContent = `Unsaved work from ${new Date(
    snapshot.savedAt,
  ).toLocaleString()} was found.`;
  bar.classList.remove("hidden");
  $("btn-recover").addEventListener("click", () => {
    void openProjectFile(
      new File([snapshot.contents], "recovered.json", {
        type: "application/json",
      }),
    ).then(() => bar.classList.add("hidden"));
  });
  $("btn-discard-recovery").addEventListener("click", () => {
    void clearSnapshot();
    bar.classList.add("hidden");
  });
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

/** dB → linear amplitude. */
function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/**
 * The metering bus every clip's chain feeds into.
 *
 * Clips used to connect straight to the destination, which leaves nothing to
 * measure: a meter has to see the sum, not one clip at a time. The bus splits
 * into two analysers so left and right read separately — a mix that is loud
 * only on one side is exactly the fault a stereo meter exists to catch — and
 * then goes on to the speakers unchanged.
 */
let meterNodes: {
  bus: GainNode;
  left: AnalyserNode;
  right: AnalyserNode;
} | null = null;

function meterBus(ctx: AudioContext): GainNode {
  if (meterNodes) return meterNodes.bus;
  const bus = ctx.createGain();
  const splitter = ctx.createChannelSplitter(2);
  const left = ctx.createAnalyser();
  const right = ctx.createAnalyser();
  // 1024 samples at 48kHz is about 21ms — short enough to see a transient,
  // long enough that RMS means something.
  left.fftSize = 1024;
  right.fftSize = 1024;
  bus.connect(splitter);
  splitter.connect(left, 0);
  splitter.connect(right, 1);
  bus.connect(ctx.destination);
  meterNodes = { bus, left, right };
  return bus;
}

/** The last reading per channel, so the peak-hold and clip latch survive
 * between frames. */
let meterReadings: [ChannelReading, ChannelReading] = [
  silentReading(),
  silentReading(),
];

/** Sample the analysers and paint the meter. Called every animation tick. */
function drawAudioMeter(): void {
  const meter = $<HTMLCanvasElement>("audio-meter");
  const ctx = meter.getContext("2d");
  if (!ctx) return;

  if (meterNodes && playback.playing) {
    const buffer = new Float32Array(meterNodes.left.fftSize);
    meterNodes.left.getFloatTimeDomainData(buffer);
    const leftReading = readChannel(buffer, meterReadings[0]);
    meterNodes.right.getFloatTimeDomainData(buffer);
    const rightReading = readChannel(buffer, meterReadings[1]);
    meterReadings = [leftReading, rightReading];
  } else if (meterNodes) {
    // Paused: no signal to read, but the hold keeps falling and the clip latch
    // stays lit until it is cleared.
    const quiet = new Float32Array(0);
    meterReadings = [
      readChannel(quiet, meterReadings[0]),
      readChannel(quiet, meterReadings[1]),
    ];
  }

  ctx.clearRect(0, 0, meter.width, meter.height);
  const barHeight = 9;
  const gap = 4;
  const clipWidth = 6;
  const trackWidth = meter.width - clipWidth - 3;
  // The empty track has to be visible against whichever theme is on. A fixed
  // translucent white vanished entirely on the light skin, leaving a meter that
  // looked like an empty box until something played.
  const style = getComputedStyle(meter);
  const trackColour = style.getPropertyValue("--line").trim() || "#8884";
  meterReadings.forEach((reading, index) => {
    const y = 4 + index * (barHeight + gap);
    ctx.fillStyle = trackColour;
    ctx.fillRect(0, y, trackWidth, barHeight);
    // RMS is the filled bar (what sounds loud), peak is a brighter cap.
    const rms = meterFraction(reading.rmsDb) * trackWidth;
    ctx.fillStyle = reading.peakDb > -6 ? "#f0b03a" : "#4ade80";
    ctx.fillRect(0, y, rms, barHeight);
    const peak = meterFraction(reading.peakDb) * trackWidth;
    ctx.fillStyle = style.getPropertyValue("--muted").trim() || "#888";
    ctx.fillRect(Math.max(0, peak - 1), y, 1.5, barHeight);
    // The falling hold mark.
    if (reading.holdDb > METER_FLOOR_DB) {
      const hold = meterFraction(reading.holdDb) * trackWidth;
      ctx.fillStyle = style.getPropertyValue("--text").trim() || "#fff";
      ctx.fillRect(Math.max(0, hold - 1), y, 1.5, barHeight);
    }
  });
  const clipped = meterReadings.some((reading) => reading.clipped);
  ctx.fillStyle = clipped ? "#ef4444" : trackColour;
  ctx.fillRect(meter.width - clipWidth, 4, clipWidth, barHeight * 2 + gap);
}

/** Clear the latched clip indicator. */
function resetAudioMeter(): void {
  meterReadings = [silentReading(), silentReading()];
  drawAudioMeter();
}

/** Lazily build (once) and return gain/pan routing for a media element.
 * `createMediaElementSource` can only run once per element and permanently
 * reroutes the element's audio into the graph, so we cache the nodes and
 * unmute (level is controlled by the GainNode from here on). */
function audioRouteFor(el: HTMLMediaElement): AudioRoute {
  let route = audioRoutes.get(el);
  if (!route) {
    const ctx = audioCtx!;
    const source = ctx.createMediaElementSource(el);
    const chain = buildAudioChain(ctx);
    source.connect(chain.low);
    chain.pan.connect(meterBus(ctx));
    el.muted = false;
    route = chain;
    audioRoutes.set(el, route);
  }
  return route;
}

/** The shared EQ → compressor → gain → pan chain, built neutral. Used for both
 * live monitoring and the offline export mixdown, so a clip that was monitored
 * one way cannot export another. */
function buildAudioChain(ctx: BaseAudioContext): AudioRoute {
  const low = ctx.createBiquadFilter();
  low.type = "lowshelf";
  low.frequency.value = EQ_LOW_HZ;
  const mid = ctx.createBiquadFilter();
  mid.type = "peaking";
  mid.frequency.value = EQ_MID_HZ;
  mid.Q.value = EQ_MID_Q;
  const high = ctx.createBiquadFilter();
  high.type = "highshelf";
  high.frequency.value = EQ_HIGH_HZ;
  const compressor = ctx.createDynamicsCompressor();
  const gain = ctx.createGain();
  const pan = ctx.createStereoPanner();

  low.connect(mid).connect(high).connect(compressor).connect(gain).connect(pan);
  applyAudioEffectsToChain({ low, mid, high, compressor, gain, pan }, []);
  return { low, mid, high, compressor, gain, pan };
}

/** Point the chain's EQ and compressor at a clip's audio effect stack.
 * Absent effects reset to neutral rather than keeping the previous clip's
 * settings, which is what makes one cached chain safe to reuse. */
function applyAudioEffectsToChain(
  route: AudioRoute,
  effects: readonly EffectInstance[],
): void {
  const eq = effects.find((fx) => fx.enabled && fx.type === "audio.eq");
  route.low.gain.value = eq ? getParamNumber(eq, "lowGainDb", 0) : 0;
  route.mid.gain.value = eq ? getParamNumber(eq, "midGainDb", 0) : 0;
  route.high.gain.value = eq ? getParamNumber(eq, "highGainDb", 0) : 0;

  const comp = effects.find(
    (fx) => fx.enabled && fx.type === "audio.compressor",
  );
  // Ratio 1:1 with a 0 dB threshold is a compressor doing nothing, which is how
  // the chain stays transparent for clips that never asked for one.
  route.compressor.threshold.value = comp
    ? getParamNumber(comp, "thresholdDb", -24)
    : 0;
  route.compressor.ratio.value = comp ? getParamNumber(comp, "ratio", 4) : 1;
  route.compressor.attack.value = comp
    ? getParamNumber(comp, "attackMs", 10) / 1000
    : 0.003;
  route.compressor.release.value = comp
    ? getParamNumber(comp, "releaseMs", 250) / 1000
    : 0.25;
}

/** Makeup gain in dB from a clip's compressor, 0 when there is none. */
function makeupGainDb(effects: readonly EffectInstance[]): number {
  const comp = effects.find(
    (fx) => fx.enabled && fx.type === "audio.compressor",
  );
  return comp ? getParamNumber(comp, "makeupGainDb", 0) : 0;
}

/** Drive live media playback to match the transport: every audio/video clip
 * active at the playhead plays its element at the right source offset with
 * that clip's gain/pan; inactive (or all, when paused) elements are paused.
 * Called on play/pause/seek and every animation tick. */
function syncAudioMonitors(): void {
  const seq = activeSequence();
  const active =
    audioCtx && seq && playback.playing
      ? resolveAtTime(seq, playback.currentTimeUs)
      : [];
  const live = new Set<HTMLMediaElement>();

  for (const layer of active) {
    const asset = findAsset(layer.assetId);
    if (!asset || asset.kind === "image") continue;
    // The original, always: a proxy carries picture only, and this is the
    // element that is actually being heard.
    const el = mediaCache.get(assetUri(asset));
    if (!(el instanceof HTMLMediaElement)) continue;
    const loc = locateClipAnywhere(layer.clipId);
    if (!loc) continue;

    const route = audioRouteFor(el);
    const audioFx = loc.clip.effects.filter((fx) => isAudioEffectType(fx.type));
    applyAudioEffectsToChain(route, audioFx);
    // Fades — authored, or implied by an overlap with a neighbour on the same
    // track — are sampled at the playhead. The export mixdown ramps the same
    // envelope sample-accurately; both read `audioEnvelopeGain`, so a fade
    // heard here is the fade that lands in the file.
    const envelope = audioEnvelopeGain(
      clipLocalTimeUs(playback.currentTimeUs, loc.clip.timelineStartUs),
      loc.clip.timelineDurationUs,
      resolveAudioFades(loc.clip, loc.track.clips),
    );
    route.gain.gain.value =
      dbToGain(loc.clip.audioGainDb + makeupGainDb(audioFx)) * envelope;
    route.pan.pan.value = Math.max(-1, Math.min(1, loc.clip.audioPan));

    // A retimed clip plays its source faster or slower; the element's own rate
    // does the resampling, so monitoring matches the exported mixdown (which
    // resamples the decoded buffer the same way, pitch and all). A ramped clip
    // has one rate per segment and the element holds only one, so the rate is
    // re-read at the playhead each tick and changes as a boundary is crossed.
    const rate = rateAtClipOffset(
      loc.clip,
      BigInt(playback.currentTimeUs) - BigInt(loc.clip.timelineStartUs),
    );
    el.playbackRate = rate.numerator / rate.denominator;

    // Resync the element clock only when it has drifted (or just started /
    // was seeked); small drift is left alone so playback stays smooth.
    const targetSec = Number(layer.sourceTimeUs) / 1_000_000;
    if (Math.abs(el.currentTime - targetSec) > 0.25) el.currentTime = targetSec;
    if (el.paused) void el.play().catch(() => undefined);
    live.add(el);
  }

  for (const [el] of audioRoutes) {
    if (!live.has(el) && !el.paused) el.pause();
  }
}

/** Resume/create the AudioContext on a user gesture (browsers require one).
 * Call from the play button before monitoring starts. */
function ensureAudioContextResumed(): void {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") void audioCtx.resume();
}

let lastFrame = performance.now();
function animate(now: number): void {
  const dt = now - lastFrame;
  lastFrame = now;
  if (playback.playing) {
    playback = tick(playback, String(Math.round(dt * 1000)));
    syncTransport();
    syncAudioMonitors();
    drawPreview();
    renderTimeline();
  }
  // Outside the branch on purpose: paused, there is no signal to read, but the
  // peak-hold still has to fall and the clip latch still has to stay lit.
  drawAudioMeter();
  requestAnimationFrame(animate);
}

function stepFrame(delta: number): void {
  const frame = timeToFrameIndex(playback.currentTimeUs, FRAME_RATE) + delta;
  const clamped = Math.max(0, frame);
  playback = seek(playback, frameToStartTimeUs(clamped, FRAME_RATE));
  syncTransport();
  drawPreview();
  renderTimeline();
  renderInspector();
}

// ==========================================================================
// UI orchestration
// ==========================================================================
function updateUI(): void {
  versionBadge.textContent = `v${session.getVersion()}`;
  syncPlaybackDuration();
  renderMedia();
  renderVectorShapes();
  renderEffectsPalette();
  renderLooks();
  renderHistory();
  renderTimeline();
  renderInspector();
  renderGifPanel();
  syncTransport();
  drawPreview();
}

/** Effects are declared for "video" or "photo"; GIF is fed by the same
 * timeline as video, so it offers the same effect set. */
/** Which of the two effect sets a mode uses. Animation clips are generated
 * stills rather than footage, so they take the photo set — the same one that
 * carries Text, Border and Tint, which is what a caption or a cartoon wants. */
function effectMode(): "video" | "photo" {
  return mode === "photo" || mode === "animation" ? "photo" : "video";
}

const MODE_EMPTY_HINT: Record<EditorMode, string> = {
  photo: "Import a photo to start editing.",
  video: "Import media, then add it to the timeline to preview.",
  animation:
    "Add a cartoon clip below, then animate it with keyframes or Auto Motion.",
  gif: "Import a video or photos, add them to the timeline, then export a GIF.",
};

/** Rotates the drum so `mode` faces the viewer and fades the others by how far
 * they have turned away. Angles are absolute (not wrapped), so the wheel never
 * spins the long way round to reach a neighbour. */
function renderModeWheel(): void {
  const activeIndex = MODE_ORDER.indexOf(mode);
  $("mode-wheel-drum").style.setProperty(
    "--angle",
    `${-activeIndex * MODE_WHEEL_STEP_DEG}deg`,
  );
  MODE_ORDER.forEach((id, index) => {
    const item = $(`mode-${id}`);
    const selected = index === activeIndex;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-checked", String(selected));
    // Roving tabindex: the group is one tab stop, arrows move within it.
    item.tabIndex = selected ? 0 : -1;
    item.style.setProperty("--distance", String(Math.abs(index - activeIndex)));
  });
}

function setMode(next: EditorMode): void {
  mode = next;
  document.body.dataset["mode"] = mode;
  renderModeWheel();
  // Photo mode edits a single still image — the scrub timeline and transport
  // (play/seek/timecode) only make sense once there's a video to play through.
  // GIF is built from the timeline, so it keeps both.
  $("app").classList.toggle("mode-photo", mode === "photo");
  // Animation builds motion out of generated clips, so the raster (pixel)
  // tools are noise there — but the timeline and transport are essential,
  // which is why it does not share photo mode's chrome.
  $("app").classList.toggle("mode-animation", mode === "animation");
  // Mode-appropriate empty-state guidance (the timeline is hidden in photo
  // mode, so "add it to the timeline" would be confusing there).
  stageEmpty.textContent = MODE_EMPTY_HINT[mode];
  $("btn-export").textContent = mode === "gif" ? "⤓ Export GIF" : "⤓ Export";
  $("gif-section").classList.toggle("hidden", mode !== "gif");
  // Selecting GIF is the signal to fetch the encoder — by the time settings
  // are dialled in, the export can start immediately.
  if (mode === "gif") void warmGifEncoder();
  renderGifPanel();
  renderInspector();
  renderEffectsPalette();
  renderLooks();
}

/** Steps the wheel by `delta` positions, clamped at both ends (the drum is a
 * finite list, not an endless loop — wrapping from GIF back to Photo would
 * read as the wheel jumping backwards). */
function stepMode(delta: number): void {
  const next = MODE_ORDER[
    Math.min(
      MODE_ORDER.length - 1,
      Math.max(0, MODE_ORDER.indexOf(mode) + delta),
    )
  ] as EditorMode;
  if (next !== mode) setMode(next);
}

function bindModeWheel(): void {
  const wheel = $("mode-wheel");
  let dragFrom: number | null = null;
  // Distance of the drag that is finishing, so the click it also produces is
  // not read as a second, contradictory step.
  let draggedDistance = 0;

  for (const id of MODE_ORDER) {
    $(`mode-${id}`).addEventListener("click", () => setMode(id));
  }

  // A neighbour's sliver is a rotated 3D face — clicking it usually lands on
  // the drum behind it rather than the face. Treat a click anywhere in the
  // housing as "turn towards the half that was clicked", which is how a
  // physical wheel behaves anyway.
  wheel.addEventListener("click", (e) => {
    if (draggedDistance > MODE_WHEEL_DRAG_PX) return;
    if ((e.target as HTMLElement).closest(".mode-wheel-item")) return;
    const box = wheel.getBoundingClientRect();
    stepMode(e.clientY < box.top + box.height / 2 ? -1 : 1);
  });

  // Trackpads emit a stream of small deltas; accumulate so one physical flick
  // is one step rather than three.
  let scrolled = 0;
  wheel.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      scrolled += e.deltaY;
      while (Math.abs(scrolled) >= MODE_WHEEL_SCROLL_PX) {
        stepMode(Math.sign(scrolled));
        scrolled -= Math.sign(scrolled) * MODE_WHEEL_SCROLL_PX;
      }
    },
    { passive: false },
  );

  wheel.addEventListener("pointerdown", (e) => {
    dragFrom = e.clientY;
    draggedDistance = 0;
    wheel.setPointerCapture(e.pointerId);
  });
  wheel.addEventListener("pointermove", (e) => {
    if (dragFrom === null) return;
    const travelled = e.clientY - dragFrom;
    draggedDistance = Math.max(draggedDistance, Math.abs(travelled));
    if (Math.abs(travelled) < MODE_WHEEL_DRAG_PX) return;
    // Dragging down brings the previous mode into view, like a physical drum.
    stepMode(-Math.sign(travelled));
    dragFrom = e.clientY;
  });
  const endDrag = (e: PointerEvent): void => {
    if (dragFrom === null) return;
    dragFrom = null;
    if (wheel.hasPointerCapture(e.pointerId)) {
      wheel.releasePointerCapture(e.pointerId);
    }
  };
  wheel.addEventListener("pointerup", endDrag);
  wheel.addEventListener("pointercancel", endDrag);

  wheel.addEventListener("keydown", (e) => {
    const byKey: Record<string, () => void> = {
      ArrowDown: () => stepMode(1),
      ArrowRight: () => stepMode(1),
      ArrowUp: () => stepMode(-1),
      ArrowLeft: () => stepMode(-1),
      Home: () => setMode(MODE_ORDER[0]!),
      End: () => setMode(MODE_ORDER[MODE_ORDER.length - 1]!),
    };
    const action = byKey[e.key];
    if (!action) return;
    e.preventDefault();
    action();
    $(`mode-${mode}`).focus();
  });
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

/** Tokens for the current selection *in the given mode*. Presets ship a
 * palette per mode; a custom theme is flipped into the mode it was not
 * authored for. Both matter because these land as inline vars on <html>, which
 * outrank the [data-theme] rules — resolving without the mode is what makes
 * the dark/light switch look dead once a palette is picked. */
function resolveSelectionTokens(
  selection: string,
  mode: "dark" | "light",
): ThemeTokens | null {
  if (selection === "default") return null;
  if (selection in PRESETS) return presetTokens(selection, mode);
  if (selection.startsWith("custom:")) {
    const name = selection.slice("custom:".length);
    const entry = loadCustomThemes().find((c) => c.name === name);
    if (!entry) return null;
    const authored = entry.seeds;
    const s =
      seedsAreDark(authored) === (mode === "dark")
        ? authored
        : counterpartSeeds(authored);
    return deriveTheme(s.bg, s.panel, s.text, s.accent);
  }
  return null;
}

/** Re-apply the selected palette for whatever mode is currently resolved. */
function refreshThemeTokens(): void {
  applyThemeTokens(
    resolveSelectionTokens(
      currentThemeSelection(),
      resolveTheme(currentThemePreference()),
    ),
  );
}

function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveTheme(pref));
  root.setAttribute("data-theme-pref", pref);
  localStorage.setItem(THEME_STORAGE_KEY, pref);
  for (const id of ["theme-dark", "theme-light", "theme-system"] as const) {
    $(id).classList.toggle("active", id === `theme-${pref}`);
  }
  refreshThemeTokens();
  renderThemePanel();
}

function applyThemeSelection(selection: string): void {
  setThemeSelection(selection);
  refreshThemeTokens();
  renderThemePanel();
}

/** UI style (skin) swatches — orthogonal to the color theme below them. */
function renderSkinPanel(): void {
  const active = currentSkin();
  const grid = $<HTMLDivElement>("skin-grid");
  grid.innerHTML = "";
  for (const skin of SKINS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `skin-swatch${skin.id === active ? " active" : ""}`;
    btn.style.background = skin.preview;
    btn.title = skin.blurb;
    const label = document.createElement("span");
    label.className = "skin-swatch-label";
    label.textContent = skin.label;
    btn.appendChild(label);
    btn.addEventListener("click", () => {
      applySkin(skin.id);
      renderSkinPanel();
    });
    grid.appendChild(btn);
  }
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

  // Swatches preview the palette in the mode the editor is actually in.
  const mode = resolveTheme(currentThemePreference());
  for (const [key, preset] of Object.entries(PRESETS)) {
    const seeds = preset[mode];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `theme-swatch${selection === key ? " active" : ""}`;
    btn.style.background = `linear-gradient(135deg, ${seeds.bg}, ${seeds.accent})`;
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
  // applyTheme also lands the selected palette for the resolved mode.
  applyTheme(currentThemePreference());
  // Re-apply the persisted skin: index.html sets it pre-paint without
  // validating, so this is where an unknown id falls back to "default".
  applySkin(currentSkin());
  renderSkinPanel();
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
    refreshThemeTokens();
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
  { id: "aibgremove", icon: "🧠", label: "AI Remove Background" },
];

function hexToRgbColor(hex: string): { r: number; g: number; b: number } {
  const [r, g, b] = hexToRgb(hex);
  return { r, g, b };
}

function startRasterSession(
  clipId: string,
  session: RasterSession,
  initialTool: RasterTool = "brush",
): void {
  rasterSession = session;
  rasterEditingClipId = clipId;
  rasterTool = initialTool;
  rasterSelection = null;
  rasterSelectionOverlay = null;
  rasterDrag = null;
  cloneSource = null;
  playback = pause(playback);
  syncTransport();
  syncAudioMonitors();
  bindRasterCanvasEvents();
  updateUI();
}

function enterRasterMode(clipId: string, initialTool: RasterTool = "brush"): boolean {
  const loc = locateClip(clipId);
  if (!loc) return false;
  const asset = findAsset(loc.clip.assetId);
  if (!asset || asset.kind !== "image") {
    toast("Only photo (image) clips can be edited here.", true);
    return false;
  }
  const media = mediaCache.get(assetUri(asset));
  if (!media || !(media instanceof HTMLImageElement)) {
    toast("This photo hasn't finished loading yet.", true);
    return false;
  }
  const width = media.naturalWidth || asset.metadata.width || 1;
  const height = media.naturalHeight || asset.metadata.height || 1;
  startRasterSession(clipId, RasterSession.fromSource(media, width, height), initialTool);
  return true;
}

/** One-click AI background removal straight from the Inspector: open the photo
 * editor with the AI tool, run real U²-Net segmentation, and remove the
 * background in a single gesture. The user lands on the finished cutout and
 * just clicks Apply (or Undo/refine with the selection tools). */
async function quickAiRemoveBackground(clipId: string): Promise<void> {
  if (!enterRasterMode(clipId, "aibgremove")) return;
  await runAiSegmentation();
  if (!rasterSession || !rasterSelection) return;
  rasterSession.snapshot();
  applyMaskDelete(rasterSession.image, invertMask(rasterSelection));
  redrawRasterCanvas();
  renderRasterPanel();
  toast('AI removed the background. Click "✓ Apply" to keep it — or Undo to refine.');
}

/** Wait until the video element has actually seeked to `targetSeconds` before
 * reading pixels — `currentTime` assignment is async, so capturing
 * immediately could grab the previous frame. */
/**
 * Put a decode-only video element in the document, invisibly.
 *
 * A detached `<video>` is never composited, and a browser does not present
 * frames for something it is not compositing. Everything that reports a seek
 * as finished — `seeked`, `currentTime`, `requestVideoFrameCallback` — then
 * describes the seek rather than the picture, and `drawImage` keeps copying
 * whichever frame was last presented. Exports read the element exactly once,
 * so they get that stale frame with no repaint to correct it.
 *
 * `display: none` and `visibility: hidden` suppress compositing just as being
 * detached does, so the element has to stay technically rendered: one pixel,
 * fully transparent, out of the layout and ignoring input.
 */
function attachOffscreen(video: HTMLVideoElement): void {
  video.playsInline = true;
  Object.assign(video.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
    zIndex: "-1",
  });
  video.setAttribute("aria-hidden", "true");
  document.body.appendChild(video);
}

/** Safety net for the frame wait. With the element composited this normally
 * resolves within a frame or two; the cap only stops a browser that declines
 * to present from hanging an export. */
const FRAME_PRESENT_TIMEOUT_MS = 300;

/**
 * Safety net for the seek itself, which is a different thing to cap.
 *
 * A seek has no failure event: an element that stops decoding part-way simply
 * never fires `seeked`, and an export waiting on it waits forever. This ends
 * that wait — but unlike the net above it throws rather than resolves.
 * Resolving would hand `drawImage` whichever frame happened to be presented
 * last and write a file that is quietly wrong, which is the exact failure this
 * function was written to prevent and the one this project has already shipped
 * twice (LESSONS.md, 2026-08-08). A stuck export that says so is recoverable;
 * a finished export that lied is not.
 */
const SEEK_LANDED_TIMEOUT_MS = 10_000;

/**
 * Seek `video` and resolve once the target frame can actually be drawn.
 *
 * The tempting checks are all wrong on their own. `currentTime` reports the
 * *requested* position, so it reads as the target the instant a seek is issued
 * — and drawLayer issues one on every preview repaint, so an export arriving
 * moments later sees the right number over the wrong picture. `seeked` says
 * the seek finished, not that the frame was presented. Measured mid-export:
 * `currentTime` 4, `seeking` true, `readyState` 1 — no frame data at all,
 * while the old early-return returned in 0ms and drawImage copied the frame
 * from before the seek.
 *
 * `requestVideoFrameCallback` reports the frame that was actually presented,
 * and its `mediaTime` says which one, so that is what this waits for.
 */
function seekVideoFrame(
  video: HTMLVideoElement,
  targetSeconds: number,
): Promise<void> {
  const atTarget = Math.abs(video.currentTime - targetSeconds) < 0.02;
  // Nothing pending and a decoded frame already up: it is on screen now.
  if (
    atTarget &&
    !video.seeking &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let guard: ReturnType<typeof setTimeout> | undefined;
    const listeners = new AbortController();
    const done = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (guard !== undefined) clearTimeout(guard);
      listeners.abort();
      if (error) reject(error);
      else resolve();
    };
    const awaitPresentedFrame = (): void => {
      // The seek landed, so its cap has done its job; from here the
      // frame-present net below is the one that applies.
      if (guard !== undefined) {
        clearTimeout(guard);
        guard = undefined;
      }
      if (typeof video.requestVideoFrameCallback !== "function") {
        done();
        return;
      }
      const onFrame = (_now: number, metadata: { mediaTime: number }): void => {
        if (settled) return;
        // Frames already in flight can arrive first; keep waiting for the one
        // whose own timestamp is the frame that was asked for.
        if (Math.abs(metadata.mediaTime - targetSeconds) < 0.05) {
          done();
          return;
        }
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
      setTimeout(() => done(), FRAME_PRESENT_TIMEOUT_MS);
    };

    video.addEventListener(
      "error",
      () =>
        done(
          new Error(
            `video errored while seeking to ${targetSeconds.toFixed(3)}s`,
          ),
        ),
      { signal: listeners.signal },
    );

    if (atTarget) {
      // A seek to this same time is already in flight — started by drawLayer's
      // fire-and-forget preview seek. Re-assigning currentTime here would be a
      // no-op that never fires `seeked`, so just wait for the picture.
      awaitPresentedFrame();
      return;
    }
    // `once`, as before the abort signal was introduced: another seek landing
    // on this element mid-wait must not start a second frame-wait alongside
    // the first.
    video.addEventListener("seeked", () => awaitPresentedFrame(), {
      once: true,
      signal: listeners.signal,
    });
    guard = setTimeout(
      () =>
        done(
          new Error(`seek to ${targetSeconds.toFixed(3)}s never completed`),
        ),
      SEEK_LANDED_TIMEOUT_MS,
    );
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
  const media = mediaCache.get(assetUri(asset));
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
    case "aibgremove": {
      const s = section("AI Remove Background");
      const hint = document.createElement("p");
      hint.className = "raster-hint";
      hint.textContent =
        "Real foreground segmentation (U²-Net, ONNX Runtime Web) running locally in your browser — " +
        "no server, no account, no per-image network call. Understands the subject semantically, so it " +
        "handles busy or textured backgrounds the color-key tool can't.";
      s.appendChild(hint);

      const modelRow = document.createElement("div");
      modelRow.className = "raster-toolbar";
      const modelChoices: Array<["fast" | "accurate", string]> = [
        ["fast", "Fast (4.4 MB, bundled)"],
        ["accurate", "Accurate (168 MB, downloads once)"],
      ];
      for (const [value, label] of modelChoices) {
        const btn = document.createElement("button");
        btn.className = `mini${rasterOptions.aiModel === value ? " active" : ""}`;
        btn.textContent = label;
        btn.disabled = aiSegmentationBusy;
        btn.addEventListener("click", () => {
          rasterOptions.aiModel = value;
          renderRasterPanel();
        });
        modelRow.appendChild(btn);
      }
      s.appendChild(modelRow);

      if (aiSegmentationBusy) {
        const status = document.createElement("p");
        status.className = "raster-hint";
        status.textContent =
          "Segmenting… first run on Accurate downloads the model (~168 MB, cached after that).";
        s.appendChild(status);
      }

      const segmentBtn = document.createElement("button");
      segmentBtn.className = "tool primary";
      segmentBtn.textContent = aiSegmentationBusy ? "Segmenting…" : "Segment Subject";
      segmentBtn.disabled = aiSegmentationBusy;
      segmentBtn.addEventListener("click", () => void runAiSegmentation());
      s.appendChild(segmentBtn);

      if (rasterSelection) {
        const removeBtn = document.createElement("button");
        removeBtn.className = "tool primary";
        removeBtn.style.marginTop = "8px";
        removeBtn.textContent = "Remove Background (keep subject)";
        removeBtn.addEventListener("click", () => {
          if (!rasterSession || !rasterSelection) return;
          rasterSession.snapshot();
          applyMaskDelete(rasterSession.image, invertMask(rasterSelection));
          redrawRasterCanvas();
          renderRasterPanel();
        });
        s.appendChild(removeBtn);
      }
      body.appendChild(s);
      if (rasterSelection) rasterSelectionActions(body);
      break;
    }
    default:
      break;
  }
}

async function runAiSegmentation(): Promise<void> {
  if (!rasterSession || aiSegmentationBusy) return;
  aiSegmentationBusy = true;
  renderRasterPanel();
  try {
    const model: SegmentationModel =
      rasterOptions.aiModel === "accurate" ? U2NET_MODEL : U2NETP_MODEL;
    const mask = await segmentForeground(rasterSession.image, model);
    setRasterSelection(mask);
    toast('Subject segmented. Click "Remove Background" or use the selection actions below.');
  } catch (err) {
    toast(err instanceof Error ? err.message : "AI segmentation failed.", true);
  } finally {
    aiSegmentationBusy = false;
    renderRasterPanel();
  }
}

async function applyRasterEdit(): Promise<void> {
  if (!rasterSession || !rasterEditingClipId) return;
  const loc = locateClip(rasterEditingClipId);
  const sourceAsset = loc ? findAsset(loc.clip.assetId) : undefined;
  try {
    const blob = await rasterSession.toBlob();
    const checksum = await checksumBlob(blob);
    const url = URL.createObjectURL(blob);
    const assetId = `asset-${crypto.randomUUID().slice(0, 8)}`;
    const baseName = sourceAsset ? assetName(sourceAsset) : "photo";
    assetNames.set(assetId, `edited-${baseName.replace(/\.[^.]+$/, "")}.png`);
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

    // Swap the edited photo in for the original on the timeline, so the
    // preview and export show the edit. There's no "change clip asset"
    // command, so replace the clip (delete + re-add) preserving its position,
    // trim, effects, and audio.
    const freshLoc = locateClip(rasterEditingClipId);
    if (freshLoc) {
      const old = freshLoc.clip;
      const newClipId = `clip-${crypto.randomUUID().slice(0, 8)}`;
      commit(
        buildDeleteClip(nextCtx(), {
          sequenceId: SEQUENCE_ID,
          clipId: old.id,
        }),
      );
      const added = commit(
        buildAddClip(nextCtx(), {
          sequenceId: SEQUENCE_ID,
          trackId: freshLoc.track.id,
          clip: {
            id: newClipId,
            assetId,
            timelineStartUs: old.timelineStartUs,
            sourceInUs: old.sourceInUs,
            sourceOutUs: old.sourceOutUs,
            playbackRate: old.playbackRate,
          },
        }),
      );
      if (added) {
        for (const fx of old.effects) {
          commit(
            buildAddEffect(nextCtx(), {
              sequenceId: SEQUENCE_ID,
              clipId: newClipId,
              effect: fx,
            }),
          );
        }
        if (old.audioGainDb !== 0) {
          commit(
            buildSetClipAudioGain(nextCtx(), {
              sequenceId: SEQUENCE_ID,
              clipId: newClipId,
              gainDb: old.audioGainDb,
            }),
          );
        }
        if (old.audioPan !== 0) {
          commit(
            buildSetClipAudioPan(nextCtx(), {
              sequenceId: SEQUENCE_ID,
              clipId: newClipId,
              pan: old.audioPan,
            }),
          );
        }
        selectClip(newClipId);
      }
      toast("Applied. The edited photo replaced the original on the timeline.");
    } else {
      toast(
        "Applied. Your edit is a new photo in the Media bin — drag it onto the timeline.",
      );
    }
    exitRasterMode();
  } catch (err) {
    toast(err instanceof Error ? err.message : "Failed to apply the edit.", true);
  }
}

// ==========================================================================
// Events
// ==========================================================================
function bindEvents(): void {
  bindModeWheel();
  bindGifPanel();

  // Photo mode hides the timeline (nothing to scrub for a still image), so
  // drag-and-drop needs a target there too — the stage itself.
  stageEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    stageEl.classList.add("dragover");
  });
  stageEl.addEventListener("dragleave", () => stageEl.classList.remove("dragover"));
  stageEl.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    stageEl.classList.remove("dragover");
    hideDropOverlay();
    const assetId = e.dataTransfer?.getData("application/x-asset-id");
    if (assetId) {
      const asset = findAsset(assetId);
      if (asset) {
        addAssetToTimeline(
          asset.id,
          asset.kind,
          asset.metadata.durationUs ?? "5000000",
          undefined,
          rangeFor(asset),
        );
      }
    } else if (e.dataTransfer?.files.length) {
      void importFiles(e.dataTransfer.files);
    }
  });

  $("theme-dark").addEventListener("click", () => applyTheme("dark"));
  $("theme-light").addEventListener("click", () => applyTheme("light"));
  $("theme-system").addEventListener("click", () => applyTheme("system"));
  bindThemePicker();

  $("btn-import").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const files = fileInput.files;
    if (files && files.length > 0) void importFiles(files);
    fileInput.value = "";
  });

  // Before/After: hold the button (or the preview) to peek at the original.
  const compareBtn = $<HTMLButtonElement>("btn-compare");
  const showBefore = (on: boolean) => {
    if (rasterSession) return; // raster editor draws its own canvas
    compareShowOriginal = on;
    compareBtn.classList.toggle("active", on);
    drawPreview();
  };
  compareBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    showBefore(true);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) {
    compareBtn.addEventListener(ev, () => showBefore(false));
  }

  // Media bin: toggle between list and gallery grid.
  $("btn-gallery-toggle").addEventListener("click", () => {
    galleryGrid = !galleryGrid;
    $("btn-gallery-toggle").textContent = galleryGrid ? "☰ List" : "▦ Grid";
    renderMedia();
  });

  $("btn-undo").addEventListener("click", () => {
    if (session.undo()) updateUI();
  });
  $("btn-redo").addEventListener("click", () => {
    if (session.redo()) updateUI();
  });

  $("btn-play").addEventListener("click", () => {
    if (!playback.playing) ensureAudioContextResumed();
    playback = playback.playing ? pause(playback) : play(playback);
    syncTransport();
    syncAudioMonitors();
    if (!playback.playing) renderInspector();
  });
  $("btn-start").addEventListener("click", () => {
    playback = seek(playback, "0");
    syncTransport();
    syncAudioMonitors();
    drawPreview();
    renderTimeline();
    renderInspector();
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
    syncAudioMonitors();
    drawPreview();
    renderTimeline();
    renderInspector();
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

  $("btn-delete").addEventListener("click", () => deleteSelection(false));
  $("btn-ripple-delete").addEventListener("click", () => deleteSelection(true));

  // The static half of the report never changes; the quality line does, so it
  // is refreshed each time the panel is opened rather than left stale.
  const capabilitiesBody = document.getElementById("system-capabilities-body");
  const qualityLine = document.createElement("p");
  const codecLines = document.createElement("div");
  const renderCapabilities = (): void => {
    qualityLine.textContent = describeQuality(
      adaptiveQuality,
      qualityPreference,
    );
    // Codec support is known only once the export dialog has probed at the
    // chosen size, so this fills in rather than being blank forever.
    codecLines.innerHTML = "";
    for (const line of describeCodecSupport(codecSupport)) {
      const p = document.createElement("p");
      p.textContent = line;
      codecLines.appendChild(p);
    }
  };
  if (capabilitiesBody) {
    for (const line of describeCapabilities(ENVIRONMENT)) {
      const p = document.createElement("p");
      p.textContent = line;
      capabilitiesBody.appendChild(p);
    }
    capabilitiesBody.appendChild(qualityLine);
    capabilitiesBody.appendChild(codecLines);
    renderCapabilities();
  }
  const codecSelect = document.getElementById(
    "export-codec",
  ) as HTMLSelectElement | null;
  codecSelect?.addEventListener("change", () => {
    if ((ATTEMPTABLE_CODECS as readonly string[]).includes(codecSelect.value)) {
      exportCodec = codecSelect.value as AttemptableCodec;
    }
  });

  const qualitySelect = document.getElementById(
    "preview-quality",
  ) as HTMLSelectElement | null;
  if (qualitySelect) {
    qualitySelect.value = qualityPreference;
    qualitySelect.addEventListener("change", () => {
      if (!isQualityPreference(qualitySelect.value)) return;
      qualityPreference = qualitySelect.value;
      localStorage.setItem(QUALITY_PREF_KEY, qualityPreference);
      // Back to auto means measuring again from where it is, not from the
      // original guess: the machine has not changed, only the instruction.
      renderCapabilities();
      drawPreview();
    });
  }
  document
    .getElementById("system-capabilities")
    ?.addEventListener("toggle", renderCapabilities);
  $("btn-make-compound").addEventListener("click", () => void makeCompoundClip());
  $("btn-add-adjustment").addEventListener(
    "click",
    () => void addAdjustmentLayer(),
  );
  $("btn-split").addEventListener("click", splitSelectedClip);
  $("btn-export").addEventListener("click", doExport);

  // Export modal.
  $("btn-export-start").addEventListener("click", () =>
    void startExportFromModal(),
  );
  $("btn-export-close").addEventListener("click", () => {
    // While an export is running this button cancels it (the run's finally
    // path closes the modal); otherwise it just dismisses the dialog.
    if (exportInFlight && videoExportAbort) {
      videoExportAbort.cancelled = true;
    } else {
      closeExportModal();
    }
  });
  initExportOptions();

  $("btn-save-project").addEventListener("click", () => void saveProject());
  $("btn-save-as").addEventListener("click", () => void saveProject(true));
  $("recent-projects").addEventListener("change", () => {
    const select = $<HTMLSelectElement>("recent-projects");
    const name = select.value;
    select.value = "";
    if (name) void openRecentProject(name);
  });
  void renderRecentProjects();
  $("btn-open-project").addEventListener("click", () =>
    $<HTMLInputElement>("project-input").click(),
  );
  $("project-input").addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void openProjectFile(file);
    // Cleared so choosing the same file twice still fires a change.
    input.value = "";
  });
  $("btn-relink").addEventListener("click", () =>
    $<HTMLInputElement>("relink-input").click(),
  );
  $("relink-input").addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.files) void relinkFiles(input.files);
    input.value = "";
  });
  startAutosave();
  void offerRecovery();

  // Culling controls. Both are view state, so they re-render the bin without
  // touching the project or the command log.
  $("media-search").addEventListener("input", () => {
    mediaSearch = $<HTMLInputElement>("media-search").value;
    renderMedia();
  });
  $("edit-mode").addEventListener("change", () => {
    editMode = $<HTMLSelectElement>("edit-mode").value as typeof editMode;
  });
  $("media-keyword").addEventListener("change", () => {
    mediaKeyword = $<HTMLSelectElement>("media-keyword").value;
    renderMedia();
  });
  $("btn-save-view").addEventListener("click", () => {
    const name = window.prompt("Name this view", "Selects")?.trim();
    if (!name) return;
    const views = loadSavedViews().filter((view) => view.name !== name);
    views.push({
      name,
      search: mediaSearch,
      keyword: mediaKeyword,
      filter: mediaFilter,
    });
    storeSavedViews(views);
    renderSavedViews();
    toast(`Saved view "${name}".`);
  });
  $("media-view").addEventListener("change", () => {
    const chosen = $<HTMLSelectElement>("media-view").value;
    const view = loadSavedViews().find((candidate) => candidate.name === chosen);
    if (!view) return;
    mediaSearch = view.search;
    mediaKeyword = view.keyword;
    mediaFilter = view.filter;
    $<HTMLInputElement>("media-search").value = view.search;
    $<HTMLSelectElement>("media-filter").value = view.filter;
    renderMedia();
  });
  renderSavedViews();
  const proxyToggle = $<HTMLInputElement>("proxy-enabled");
  proxyToggle.checked = useProxies;
  proxyToggle.addEventListener("change", () => {
    useProxies = proxyToggle.checked;
    localStorage.setItem(PROXY_PREF_KEY, useProxies ? "on" : "off");
    toast(
      useProxies
        ? "Editing against proxies where they exist."
        : "Editing against the originals.",
    );
    renderMedia();
    updateUI();
  });
  $("btn-clear-proxies").addEventListener("click", () => void discardProxies());
  const scopeSelect = $<HTMLSelectElement>("scope-kind");
  scopeSelect.value = scopeKind;
  scopeSelect.addEventListener("change", () => {
    scopeKind = scopeSelect.value as ScopeKind;
    // Repaint rather than measure what is already on the canvas: paused, the
    // scope would otherwise read whatever was last drawn, and turning one on
    // would show nothing until the next redraw.
    drawPreview();
  });
  $("btn-meter-reset").addEventListener("click", () => resetAudioMeter());
  updateProxyStatus();
  $("media-filter").addEventListener("change", () => {
    mediaFilter = $<HTMLSelectElement>("media-filter").value as MediaFilter;
    renderMedia();
  });

  window.addEventListener("keydown", (e) => {
    if (e.target !== document.body) return;
    if ((e.metaKey || e.ctrlKey) && e.code === "KeyS") {
      e.preventDefault();
      void saveProject(e.shiftKey);
    } else if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
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
      // Shift+Delete ripples: the gap closes behind the deleted clips.
      deleteSelection(e.shiftKey);
    } else if (e.code === "KeyM" && !e.metaKey && !e.ctrlKey) {
      addMarkerAtPlayhead(e.shiftKey ? "todo" : "standard");
    } else if (e.code === "Space") {
      e.preventDefault();
      if (!playback.playing) ensureAudioContextResumed();
      playback = playback.playing ? pause(playback) : play(playback);
      syncTransport();
      syncAudioMonitors();
    }
  });

  window.addEventListener("resize", drawPreview);

  // External file drag & drop anywhere in the window.
  const overlay = $<HTMLDivElement>("drop-overlay");
  const hasFiles = (e: DragEvent): boolean =>
    e.dataTransfer?.types.includes("Files") ?? false;
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dropOverlayDepth += 1;
    overlay.classList.remove("hidden");
  });
  window.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    dropOverlayDepth = Math.max(0, dropOverlayDepth - 1);
    if (dropOverlayDepth === 0) overlay.classList.add("hidden");
  });
  window.addEventListener("drop", (e) => {
    hideDropOverlay();
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

/** Triggers a real browser download of `blob` named `filename`. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a tick to start before revoking the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Renders the current visual layer(s) at full native resolution — same
 * effects as the live preview, baked in — onto a fresh offscreen canvas.
 * Returns null if there's nothing visible to export.
 *
 * Async because a video layer has to be seeked and decoded before it can be
 * drawn. drawLayer's own seek is fire-and-forget — it schedules a redraw for
 * the preview, which repaints continuously — and it is skipped entirely while
 * the transport is playing. Neither is any use to a one-shot export, so this
 * awaits the frame the way the GIF and MP4 loops already do. */
async function renderExportFrame(): Promise<HTMLCanvasElement | null> {
  const seq = activeSequence();
  const exportProject = session.getProject();
  const layers =
    seq && exportProject
      ? resolveAtTimeDeep(exportProject, seq.id, playback.currentTimeUs)
      : [];
  const visual = layers.filter((l) => {
    const a = findAsset(l.assetId);
    return a && a.kind !== "audio";
  });
  if (visual.length === 0) return null;

  // Export resolution: the topmost visual layer's own (post-crop) frame
  // size, so a cropped photo exports at the cropped size, not upscaled.
  const top = visual[0]!;
  const topLoc = locateClip(top.clipId);
  if (!topLoc) return null;
  const topAsset = findAsset(topLoc.clip.assetId);
  if (!topAsset) return null;
  const media = mediaFor(topAsset);
  let mw = topAsset.metadata.width ?? 1920;
  let mh = topAsset.metadata.height ?? 1080;
  if (media instanceof HTMLImageElement) {
    mw = media.naturalWidth || mw;
    mh = media.naturalHeight || mh;
  } else if (media instanceof HTMLVideoElement) {
    mw = media.videoWidth || mw;
    mh = media.videoHeight || mh;
  }
  const { sw, sh } = resolveCropRect(topLoc.clip, mw, mh);

  const out = document.createElement("canvas");
  out.width = Math.round(sw);
  out.height = Math.round(sh);
  const octx = out.getContext("2d")!;
  for (const layer of [...visual].reverse()) {
    const loc = locateClipAnywhere(layer.clipId);
    if (!loc) continue;
    const layerAsset = findAsset(loc.clip.assetId);
    const layerMedia = layerAsset
      ? mediaFor(layerAsset)
      : undefined;
    if (layerMedia instanceof HTMLVideoElement) {
      await seekVideoFrame(layerMedia, Number(layer.sourceTimeUs) / 1_000_000);
    }
    paintLayer(
      octx,
      loc.clip,
      layer.sourceTimeUs,
      clipLocalTimeUs(playback.currentTimeUs, layer.timelineStartUs),
      out.width,
      out.height,
    );
  }
  return out;
}

/** Real, working image export: renders the current frame (effects baked in)
 * at full native resolution and downloads it as a PNG. No plan, no fake job —
 * a real file. */
async function exportPhotoImage(): Promise<void> {
  // Pause first: a still is "the frame at the playhead", and letting the
  // transport keep advancing during the seek means exporting a frame the
  // playhead has already left.
  if (playback.playing) {
    playback = pause(playback);
    syncTransport();
  }
  // A frame that never decoded throws rather than exporting the wrong picture;
  // say so instead of failing as an unhandled rejection.
  let canvasEl: HTMLCanvasElement | null;
  try {
    canvasEl = await renderExportFrame();
  } catch (err) {
    toast(
      `Export failed: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
    return;
  }
  if (!canvasEl) {
    toast("Nothing to export.", true);
    return;
  }
  canvasEl.toBlob((blob) => {
    if (!blob) {
      toast("Export failed: could not encode image.", true);
      return;
    }
    downloadBlob(blob, "export.png");
    toast(`Exported ${canvasEl.width}×${canvasEl.height} PNG.`);
  }, "image/png");
}

let videoExportAbort: { cancelled: boolean } | null = null;

/** Renders the deterministic audio mixdown for every audio clip in the plan
 * (respecting each clip's trim, gain, and pan) via `OfflineAudioContext`,
 * encodes it with WebCodecs `AudioEncoder` (Opus), and feeds the resulting
 * chunks into `muxer`. No-ops if the plan has no audio clips. */
async function renderAndEncodeAudio(
  plan: ExportPlan,
  preset: ExportPreset,
  // Whichever target the sink chose. The muxer's `Target` base class is not
  // exported, and the mixdown only ever calls `addAudioChunk`, which every
  // target supports — so the parameter names just that capability.
  muxer: { addAudioChunk: Muxer<ArrayBufferTarget>["addAudioChunk"] },
): Promise<void> {
  if (plan.audioClips.length === 0) return;

  const channels = 2;
  const durationSec = Number(plan.durationUs) / 1_000_000;
  const offline = new OfflineAudioContext(
    channels,
    Math.max(1, Math.ceil(durationSec * preset.audioSampleRate)),
    preset.audioSampleRate,
  );

  const decodedByAsset = new Map<string, AudioBuffer>();
  for (const clip of plan.audioClips) {
    if (decodedByAsset.has(clip.assetId)) continue;
    const asset = findAsset(clip.assetId);
    if (!asset) continue;
    const bytes = await (await fetch(assetUri(asset))).arrayBuffer();
    try {
      decodedByAsset.set(clip.assetId, await offline.decodeAudioData(bytes));
    } catch {
      // Source has no decodable audio track (e.g. a silent test clip) — skip it.
    }
  }

  for (const clip of plan.audioClips) {
    const buffer = decodedByAsset.get(clip.assetId);
    if (!buffer) continue;
    // Same chain as live monitoring, driven by the same effect stack. One chain
    // per clip even when the clip is ramped: gain, pan and the fade curve
    // belong to the whole clip, and only the source nodes are per segment.
    const chain = buildAudioChain(offline);
    applyAudioEffectsToChain(chain, clip.effects);
    chain.gain.gain.value = 10 ** ((clip.gainDb + makeupGainDb(clip.effects)) / 20);
    chain.pan.pan.value = Math.max(-1, Math.min(1, clip.pan));
    chain.pan.connect(offline.destination);

    const startSec = Number(clip.timelineStartUs) / 1_000_000;
    // How long the clip occupies the timeline. The fade curve spans this, while
    // each source node below is started with a *source* duration.
    const clipDurationSec = Number(clip.timelineDurationUs) / 1_000_000;
    const sourceSpanSec =
      (Number(clip.sourceOutUs) - Number(clip.sourceInUs)) / 1_000_000;
    if (sourceSpanSec <= 0 || clipDurationSec <= 0) continue;

    // Fades ride on top of the clip's static gain as a value curve over the
    // clip's own span — sample-accurate, and computed by the same function the
    // monitor polls, so the export cannot fade somewhere else.
    if (clip.fades.fadeInUs !== "0" || clip.fades.fadeOutUs !== "0") {
      const curvePoints = Math.max(
        2,
        Math.min(4096, Math.ceil(clipDurationSec * 200)),
      );
      const shape = audioEnvelopeCurve(
        clip.timelineDurationUs,
        clip.fades,
        curvePoints,
      );
      const staticGain = chain.gain.gain.value;
      const curve = new Float32Array(shape.length);
      for (let i = 0; i < shape.length; i++) curve[i] = shape[i]! * staticGain;
      chain.gain.gain.setValueCurveAtTime(curve, startSec, clipDurationSec);
    }

    // One source node per speed span — a single node carries a single rate, so
    // a ramped clip cannot be one node. An unramped clip yields exactly one
    // span covering the whole thing, which is what this always did.
    //
    // A retimed span resamples its source, pitch and all: the same varispeed
    // the live monitor applies via HTMLMediaElement.playbackRate. Pitch-
    // preserving time-stretch is a different device and is not implemented.
    for (const span of clip.spans) {
      const node = offline.createBufferSource();
      node.buffer = buffer;
      node.connect(chain.low);
      node.playbackRate.value = span.rate.numerator / span.rate.denominator;
      const spanSourceSec = Number(span.sourceDurationUs) / 1_000_000;
      if (spanSourceSec <= 0) continue;
      // The third argument is measured in source time, so it is the untimed
      // span — the rate above decides how much timeline that covers.
      node.start(
        startSec + Number(span.timelineOffsetUs) / 1_000_000,
        Number(span.sourceOffsetUs) / 1_000_000,
        spanSourceSec,
      );
    }
  }

  const rendered = await offline.startRendering();

  let audioEncodeError: Error | null = null;
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (err) => {
      audioEncodeError = err instanceof Error ? err : new Error(String(err));
    },
  });
  audioEncoder.configure({
    codec: "opus",
    sampleRate: preset.audioSampleRate,
    numberOfChannels: channels,
    bitrate: (preset.audioBitrateKbps ?? 128) * 1000,
  });

  const FRAME_SIZE = 4800; // 100ms at 48kHz — arbitrary, just a chunking size
  const channelData = [rendered.getChannelData(0), rendered.getChannelData(1)];
  for (let offset = 0; offset < rendered.length; offset += FRAME_SIZE) {
    const count = Math.min(FRAME_SIZE, rendered.length - offset);
    const planar = new Float32Array(count * channels);
    planar.set(channelData[0]!.subarray(offset, offset + count), 0);
    planar.set(channelData[1]!.subarray(offset, offset + count), count);
    const audioData = new AudioData({
      format: "f32-planar",
      sampleRate: preset.audioSampleRate,
      numberOfFrames: count,
      numberOfChannels: channels,
      timestamp: Math.round((offset / preset.audioSampleRate) * 1_000_000),
      data: planar,
    });
    audioEncoder.encode(audioData);
    audioData.close();
    if (audioEncodeError) throw audioEncodeError;
  }
  await audioEncoder.flush();
  if (audioEncodeError) throw audioEncodeError;
  audioEncoder.close();
}

/** Whether this browser can encode video client-side (WebCodecs). Older
 * Safari and any non-secure context lack it, so we check before starting an
 * export rather than throwing mid-run. */
function webCodecsSupported(): boolean {
  return (
    typeof VideoEncoder !== "undefined" &&
    typeof AudioEncoder !== "undefined" &&
    typeof VideoFrame !== "undefined"
  );
}

export type VideoExportResult =
  | {
      status: "done";
      framesTotal: number;
      durationUs: string;
      audioClips: number;
    }
  | { status: "cancelled" }
  | { status: "empty" }
  | { status: "failed"; message: string };

type ExportProgress = (phase: string, done: number, total: number) => void;

/** Real, working video export: renders every planned frame (effects baked
 * in, via the same paintLayer() used for live preview) to an offscreen
 * canvas, encodes with the browser-native WebCodecs API, and muxes video and
 * (when present) a real audio mixdown into a downloadable MP4.
 *
 * Reports progress through `onProgress`; caller drives the UI. `abort` can be
 * flipped by the caller (a Cancel button) to stop between frames. */
async function runVideoExport(
  preset: ExportPreset,
  outputFile: FileSystemFileHandle | null,
  onProgress: ExportProgress,
  abort: { cancelled: boolean },
): Promise<VideoExportResult> {
  const project = session.getProject();
  if (!project) return { status: "empty" };

  // The preset schema mirrors the Rust engine and accepts the full codec
  // matrix; this path is WebCodecs into an MP4 muxer with H.264 hardcoded.
  // Without this check an unsupported preset was accepted and then encoded as
  // H.264/MP4 anyway — a wrong file rather than an error.
  const unsupported = browserPresetUnsupportedReason(preset);
  if (unsupported !== null) {
    return { status: "failed", message: unsupported };
  }

  const result = planExport(project, SEQUENCE_ID, preset);
  if (!result.ok) {
    return { status: "failed", message: result.error.message };
  }
  const { plan } = result;
  const fps = preset.frameRate.numerator / preset.frameRate.denominator;

  let job: ExportJob = startExport(plan);

  // Everything from here reads the originals. A proxy exists to make editing
  // quick; exporting one would hand the user a soft file that nothing in the
  // interface warned them about.
  renderOriginals = true;
  exportActive = true;

  try {
    // A VideoEncoder's `error` callback fires from the codec's own internal
    // task, not from any code we called — throwing there does NOT propagate
    // to this function's try/catch. Record it and check explicitly instead.
    let encodeError: Error | null = null;

    // Where the file goes. Streaming writes straight to disk, so length is
    // bounded by the drive rather than by how much of an MP4 fits in a tab.
    // Which codec, and therefore which container and which muxer. VP9 and AV1
    // cannot be written into MP4 by mp4-muxer, and a codec in a container that
    // cannot hold it is a file nothing will play — so the two are chosen
    // together rather than independently.
    const chosenCodec: AttemptableCodec = ATTEMPTABLE_CODECS.includes(
      exportCodec as AttemptableCodec,
    )
      ? (exportCodec as AttemptableCodec)
      : "h264";
    const container = CODEC_CONTAINER[chosenCodec] as "mp4" | "webm";
    const isWebm = container === "webm";

    const sink = await createExportSink(`export.${container}`, {
      StreamTargetCtor: isWebm
        ? (WebmFileStreamTarget as unknown as typeof FileSystemWritableFileStreamTarget)
        : FileSystemWritableFileStreamTarget,
      BufferTargetCtor: isWebm
        ? (WebmArrayBufferTarget as unknown as typeof ArrayBufferTarget)
        : ArrayBufferTarget,
      download: downloadBlob,
      // Already chosen, at the click, while the page still had the user
      // activation the picker demands.
      pickFile: async () => outputFile,
    });

    const withAudio =
      preset.audioCodec !== "none" && plan.audioClips.length > 0;
    // One shape, two muxers. Their constructors agree closely enough that the
    // difference is the codec tag and the fastStart option, which WebM has no
    // equivalent of — it is seekable by construction.
    const muxer = (
      isWebm
        ? new WebmMuxer({
            target: sink.target as ConstructorParameters<
              typeof WebmMuxer
            >[0]["target"],
            video: {
              codec: chosenCodec === "av1" ? "V_AV1" : "V_VP9",
              width: preset.width,
              height: preset.height,
              frameRate: fps,
            },
            ...(preset.audioCodec !== "none" && plan.audioClips.length > 0
              ? {
                  audio: {
                    codec: "A_OPUS" as const,
                    numberOfChannels: 2,
                    sampleRate: preset.audioSampleRate,
                  },
                }
              : {}),
          })
        : newMp4Muxer()
    ) as Muxer<ArrayBufferTarget>;

    function newMp4Muxer() {
      return new Muxer({
      target: sink.target as ConstructorParameters<typeof Muxer>[0]["target"],
      video: { codec: "avc", width: preset.width, height: preset.height, frameRate: fps },
      ...(withAudio
        ? {
            audio: {
              codec: "opus" as const,
              numberOfChannels: 2,
              sampleRate: preset.audioSampleRate,
            },
          }
        : {}),
      // `in-memory` buys a seekable header by holding the whole file, which is
      // exactly what streaming exists to avoid. Streamed files put their index
      // at the end — every player handles that for a local file.
      fastStart: sink.kind === "stream" ? false : "in-memory",
      });
    }
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (err) => {
        encodeError = err instanceof Error ? err : new Error(String(err));
      },
    });
    // The level is derived from the picture, not hardcoded: a level too low for
    // the frame fails inside WebCodecs with an opaque message, and a level
    // needlessly high narrows the set of decoders that will play the file.
    const codec = codecStringFor(chosenCodec, preset.width, preset.height, fps)!;
    const config: VideoEncoderConfig = {
      codec,
      width: preset.width,
      height: preset.height,
      bitrate: preset.videoBitrateKbps * 1000,
      framerate: fps,
    };
    const support = await VideoEncoder.isConfigSupported(config);
    if (!support.supported) {
      return {
        status: "failed",
        message: `This browser cannot encode ${preset.width}x${preset.height} at ${Math.round(fps)}fps (${codec}). Try a smaller resolution or frame rate.`,
      };
    }
    videoEncoder.configure(config);

    const offCanvas = document.createElement("canvas");
    offCanvas.width = preset.width;
    offCanvas.height = preset.height;
    const offCtx = offCanvas.getContext("2d")!;

    const BATCH = 30;
    outer: for (let start = 0; start < plan.framesTotal; start += BATCH) {
      const count = Math.min(BATCH, plan.framesTotal - start);
      const requests = planVideoFrames(project, SEQUENCE_ID, preset, start, count);
      for (const req of requests) {
        if (abort.cancelled) break outer;
        offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);
        const visual = req.layers.filter((l) => {
          const a = findAsset(l.assetId);
          return a && a.kind !== "audio";
        });
        for (const layer of [...visual].reverse()) {
          const loc = locateClipAnywhere(layer.clipId);
          if (!loc) continue;
          const asset = findAsset(loc.clip.assetId);
          const media = asset ? mediaFor(asset) : undefined;
          if (media instanceof HTMLVideoElement) {
            await seekVideoFrame(media, Number(layer.sourceTimeUs) / 1_000_000);
          }
          paintLayer(
            offCtx,
            loc.clip,
            layer.sourceTimeUs,
            clipLocalTimeUs(req.timelineTimeUs, layer.timelineStartUs),
            offCanvas.width,
            offCanvas.height,
          );
        }

        const ptsUs = Number(req.timelineTimeUs);
        const nextPtsUs = Number(frameToStartTimeUs(req.frameIndex + 1, preset.frameRate));
        const frame = new VideoFrame(offCanvas, {
          timestamp: ptsUs,
          duration: nextPtsUs - ptsUs,
        });
        videoEncoder.encode(frame, { keyFrame: req.frameIndex % 60 === 0 });
        frame.close();
        if (encodeError) throw encodeError;

        job = advanceExport(job, req.frameIndex + 1);
        onProgress("Rendering frames…", job.framesDone, job.framesTotal);
      }
      // Yield to the event loop between batches so the UI (and a Cancel
      // click) stays responsive during a long export.
      await new Promise((r) => setTimeout(r, 0));
    }
    if (encodeError) throw encodeError;

    if (abort.cancelled) {
      job = cancelExport(job);
      videoEncoder.close();
      return { status: "cancelled" };
    }

    await videoEncoder.flush();
    videoEncoder.close();

    if (withAudio) {
      onProgress("Mixing audio…", plan.framesTotal, plan.framesTotal);
      await renderAndEncodeAudio(plan, preset, muxer);
    }
    onProgress("Finalizing…", plan.framesTotal, plan.framesTotal);
    muxer.finalize();
    // Closes the file, or downloads the buffer — whichever sink was chosen.
    await sink.finish();
    return {
      status: "done",
      framesTotal: plan.framesTotal,
      durationUs: plan.durationUs,
      audioClips: plan.audioClips.length,
    };
  } catch (err) {
    job = failExport(job, {
      code: "ENCODE_FAILED",
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      status: "failed",
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    renderOriginals = false;
    exportActive = false;
    resumeProxies();
  }
}

// ---- Export modal (video presets + real progress) -----------------------

let exportInFlight = false;

/** What the dialog currently says, before any validation. */
function readExportFields(): ExportFields {
  return {
    resolution: $<HTMLSelectElement>("export-resolution").value,
    customWidth: $<HTMLInputElement>("export-width").value,
    customHeight: $<HTMLInputElement>("export-height").value,
    frameRate: $<HTMLSelectElement>("export-fps").value,
    bitrateKbps:
      $<HTMLSelectElement>("export-quality").value === "custom"
        ? $<HTMLInputElement>("export-bitrate").value
        : $<HTMLSelectElement>("export-quality").value,
    audioCodec: $<HTMLSelectElement>("export-audio-codec").value,
    audioBitrateKbps: $<HTMLSelectElement>("export-audio-bitrate").value,
      videoCodec: exportCodec,
};
}

/** Fill the dialog's selects and wire the two "Custom…" reveals. */
function initExportOptions(): void {
  const fill = (id: string, choices: readonly { value: string; label: string }[], selected: string): void => {
    const select = $<HTMLSelectElement>(id);
    select.innerHTML = "";
    for (const choice of choices) {
      const option = new Option(choice.label, choice.value);
      option.selected = choice.value === selected;
      select.appendChild(option);
    }
  };
  fill("export-resolution", RESOLUTION_CHOICES, "1920x1080");
  fill("export-fps", FRAME_RATE_CHOICES, "30");
  fill("export-quality", BITRATE_CHOICES, "8000");
  fill("export-audio-bitrate", AUDIO_BITRATE_CHOICES, "128");

  const syncVisibility = (): void => {
    $("export-custom-size").classList.toggle(
      "hidden",
      $<HTMLSelectElement>("export-resolution").value !== "custom",
    );
    $("export-custom-bitrate").classList.toggle(
      "hidden",
      $<HTMLSelectElement>("export-quality").value !== "custom",
    );
    $("export-audio-bitrate-field").classList.toggle(
      "hidden",
      $<HTMLSelectElement>("export-audio-codec").value === "none",
    );
  };
  for (const id of [
    "export-resolution",
    "export-quality",
    "export-audio-codec",
    "export-fps",
  ]) {
    $(id).addEventListener("change", () => {
      syncVisibility();
      updateExportSummary();
    });
  }
  for (const id of ["export-width", "export-height", "export-bitrate"]) {
    $(id).addEventListener("input", updateExportSummary);
  }
  syncVisibility();
}

/** Refresh the "N frames · MM:SS" line under the options from the current
 * project + selected preset. */
function updateExportSummary(): void {
  const summary = $("export-summary");
  const project = session.getProject();
  if (!project) {
    summary.textContent = "";
    return;
  }
  const fields = buildExportPreset(readExportFields());
  const startBtn = $<HTMLButtonElement>("btn-export-start");
  if (!fields.ok) {
    // Refuse in the dialog, where the field is, rather than at Start.
    summary.textContent = fields.error;
    startBtn.disabled = true;
    return;
  }
  startBtn.disabled = false;

  const result = planExport(project, SEQUENCE_ID, fields.preset);
  const where = streamingExportSupported()
    ? "written straight to the file you choose"
    : "held in memory until it downloads";
  summary.textContent = result.ok
    ? `${result.plan.framesTotal} frames · ${formatTime(result.plan.durationUs)}${
        fields.preset.audioCodec === "none"
          ? " · no audio"
          : result.plan.audioClips.length > 0
            ? ` · ${result.plan.audioClips.length} audio clip(s)`
            : " · silent"
      } · ${where}`
    : result.error.message;
}

function openExportModal(): void {
  if (!webCodecsSupported()) {
    toast(
      "Video export needs the WebCodecs API, which this browser doesn't support. Try the latest Chrome or Edge.",
      true,
    );
    return;
  }
  // Reset to the options view.
  $("export-options").classList.remove("hidden");
  $("export-progress-wrap").classList.add("hidden");
  const startBtn = $<HTMLButtonElement>("btn-export-start");
  startBtn.disabled = false;
  startBtn.textContent = "Start Export";
  $("btn-export-close").textContent = "Cancel";
  updateExportSummary();
  $("export-modal").classList.remove("hidden");
  // Probed on open, at the size and rate actually chosen: support is a
  // function of level, so a browser that encodes VP9 at 720p may refuse 4K.
  // Asking at a nominal size would offer a codec that then failed at the click.
  void refreshCodecOptions();
}

/**
 * Fill the codec picker with what this browser will really encode.
 *
 * Unsupported codecs are listed and disabled with the reason attached rather
 * than hidden: "AV1 is not offered here" is a different message from "AV1 does
 * not exist", and only the first is true.
 */
async function refreshCodecOptions(): Promise<void> {
  const select = document.getElementById(
    "export-codec",
  ) as HTMLSelectElement | null;
  if (!select) return;
  const built = buildExportPreset(readExportFields());
  // An invalid field set has nothing to probe against; the summary already
  // reports why, and the picker keeps whatever it last knew.
  if (!built.ok) return;
  const preset = built.preset;
  const fps = preset.frameRate.numerator / preset.frameRate.denominator;
  select.disabled = true;
  codecSupport = await probeVideoCodecs(
    preset.width,
    preset.height,
    fps,
    preset.videoBitrateKbps,
  );

  const available = offerable(codecSupport);
  // If the chosen codec is not available at this size, fall back to whatever
  // is — silently keeping an impossible choice would fail at the click.
  if (!available.some((r) => r.codec === exportCodec)) {
    exportCodec = available[0]?.codec ?? "h264";
  }
  select.innerHTML = "";
  for (const entry of codecSupport) {
    const option = new Option(
      entry.supported
        ? CODEC_LABELS[entry.codec]
        : `${CODEC_LABELS[entry.codec]} — unavailable here`,
      entry.codec,
    );
    option.disabled = !entry.supported;
    if (entry.reason) option.title = entry.reason;
    option.selected = entry.codec === exportCodec;
    select.appendChild(option);
  }
  select.disabled = available.length <= 1;
  select.title =
    available.length <= 1
      ? "Only one codec is available in this browser at this size."
      : "";
  updateExportSummary();
  document.getElementById("system-capabilities")?.dispatchEvent(
    new Event("toggle"),
  );
}

function closeExportModal(): void {
  $("export-modal").classList.add("hidden");
}

async function startExportFromModal(): Promise<void> {
  if (exportInFlight) return;
  exportInFlight = true;
  const abort = { cancelled: false };
  videoExportAbort = abort;

  const startBtn = $<HTMLButtonElement>("btn-export-start");
  startBtn.disabled = true;
  $("export-options").classList.add("hidden");
  $("export-progress-wrap").classList.remove("hidden");
  $("btn-export-close").textContent = "Cancel Export";

  const barFill = $<HTMLDivElement>("export-bar-fill");
  const phaseEl = $("export-phase");
  const countEl = $("export-count");
  const onProgress: ExportProgress = (phase, done, total) => {
    phaseEl.textContent = phase;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    barFill.style.width = `${pct}%`;
    countEl.textContent = `${done} / ${total} frames`;
  };

  const built = buildExportPreset(readExportFields());
  if (!built.ok) {
    toast(built.error, true);
    exportInFlight = false;
    videoExportAbort = null;
    return;
  }
  // Before anything slow: the picker needs the activation from this click.
  const outputFile = await pickExportFile("export.mp4");
  const result = await runVideoExport(
    built.preset,
    outputFile,
    onProgress,
    abort,
  );

  exportInFlight = false;
  videoExportAbort = null;

  switch (result.status) {
    case "done": {
      const audioNote =
        result.audioClips > 0
          ? `${result.audioClips} audio clip(s) mixed in`
          : "silent, no audio clips";
      toast(
        `Exported ${result.framesTotal} frames, ${formatTime(result.durationUs)} (H.264/MP4, ${audioNote}).`,
      );
      break;
    }
    case "cancelled":
      toast("Export cancelled.");
      break;
    case "empty":
      toast("Nothing to export.", true);
      break;
    case "failed":
      toast(`Export failed: ${result.message}`, true);
      break;
  }
  closeExportModal();
}

// ==========================================================================
// GIF output — the third mode's export path
// ==========================================================================

interface GifSettings {
  fps: number;
  width: number;
  colors: number;
  loop: boolean;
  boomerang: boolean;
}

let gifSettings: GifSettings = {
  fps: 12,
  width: 480,
  colors: 256,
  loop: true,
  boomerang: false,
};

/** A GIF holds every frame in memory as a palettized buffer, and viewers choke
 * long before this — better a clear cap than a tab that runs out of memory. */
const GIF_MAX_FRAMES = 300;
/** Yield to the event loop this often so the UI stays responsive mid-render. */
const GIF_YIELD_EVERY = 4;

type GifEncoderStatus = "idle" | "loading" | "ready" | "failed";
let gifEncoderStatus: GifEncoderStatus = "idle";
let gifExportInFlight = false;

/** Fetches the encoder on entering GIF mode so the first export does not wait
 * on the network. Re-entrant: a second call while loading is a no-op, and a
 * previous failure is retried. */
async function warmGifEncoder(): Promise<void> {
  if (gifEncoderStatus === "loading" || gifEncoderStatus === "ready") return;
  gifEncoderStatus = "loading";
  renderGifPanel();
  try {
    await loadGifEncoder();
    gifEncoderStatus = "ready";
  } catch {
    gifEncoderStatus = "failed";
  }
  renderGifPanel();
}

function gifStatusText(): string {
  switch (gifEncoderStatus) {
    case "ready":
      return "✓ GIF encoder ready (gifenc, loaded on demand)";
    case "failed":
      return "✕ GIF encoder failed to load — check your connection and reselect GIF.";
    default:
      return "Loading GIF encoder…";
  }
}

/** Output size: the source frame's aspect at the chosen width. */
function gifOutputSize(seq: Sequence): { width: number; height: number } | null {
  const sizeProject = session.getProject();
  const visual = (
    sizeProject ? resolveAtTimeDeep(sizeProject, seq.id, "0") : []
  ).filter((l) => {
    const a = findAsset(l.assetId);
    return a && a.kind !== "audio";
  });
  const top = visual[0];
  if (!top) return null;
  const loc = locateClip(top.clipId);
  const asset = loc ? findAsset(loc.clip.assetId) : undefined;
  if (!loc || !asset) return null;
  const media = mediaCache.get(assetUri(asset));
  let mw = asset.metadata.width ?? 1920;
  let mh = asset.metadata.height ?? 1080;
  if (media instanceof HTMLImageElement) {
    mw = media.naturalWidth || mw;
    mh = media.naturalHeight || mh;
  } else if (media instanceof HTMLVideoElement) {
    mw = media.videoWidth || mw;
    mh = media.videoHeight || mh;
  }
  const { sw, sh } = resolveCropRect(loc.clip, mw, mh);
  const width = Math.max(2, Math.round(gifSettings.width));
  return { width, height: Math.max(2, Math.round((width * sh) / sw)) };
}

/** Frames the current timeline yields at the chosen rate, before boomerang. */
function gifFrameCount(seq: Sequence): number {
  const durationUs = Number(sequenceDurationUs(seq));
  const fps = clampGifFps(gifSettings.fps);
  const frames = Math.floor((durationUs / 1_000_000) * fps);
  return Math.max(1, Math.min(GIF_MAX_FRAMES, frames));
}

function renderGifPanel(): void {
  const status = $<HTMLDivElement>("gif-status");
  status.textContent = gifStatusText();
  status.className = `gif-status${gifEncoderStatus === "ready" ? " ready" : ""}${
    gifEncoderStatus === "failed" ? " failed" : ""
  }`;

  $("gif-fps-value").textContent = `${clampGifFps(gifSettings.fps)} fps`;
  $("gif-width-value").textContent = `${gifSettings.width} px`;

  const seq = activeSequence();
  const summary = $<HTMLDivElement>("gif-summary");
  const size = seq ? gifOutputSize(seq) : null;
  if (!seq || !size) {
    summary.textContent = "Add a clip to the timeline to build a GIF.";
  } else {
    const frames = gifFrameCount(seq);
    const played = boomerangOrder(frames, gifSettings.boomerang).length;
    const seconds = (played / clampGifFps(gifSettings.fps)).toFixed(1);
    summary.textContent = `${played} frames · ${size.width}×${size.height} · ${seconds}s · ${
      gifSettings.loop ? "loops" : "plays once"
    }`;
  }

  $<HTMLButtonElement>("btn-gif-export").disabled =
    gifExportInFlight || gifEncoderStatus === "failed";
}

/** Renders the timeline at the GIF's own frame rate and encodes it. Reuses the
 * same layer/draw path as video export, so effects, crops and z-order are
 * identical to what the preview shows. */
async function runGifExport(): Promise<void> {
  if (gifExportInFlight) return;
  const seq = activeSequence();
  if (!seq || sequenceDurationUs(seq) === "0") {
    toast("Add a clip to the timeline first.", true);
    return;
  }
  const size = gifOutputSize(seq);
  if (!size) {
    toast("Nothing visual on the timeline to turn into a GIF.", true);
    return;
  }

  gifExportInFlight = true;
  renderGifPanel();
  const status = $<HTMLDivElement>("gif-status");
  const fps = clampGifFps(gifSettings.fps);
  const frameCount = gifFrameCount(seq);
  // As with video: a file the user keeps comes from the originals.
  renderOriginals = true;
  exportActive = true;

  try {
    const sink = await createGifEncoder({
      fps,
      loop: gifSettings.loop,
      boomerang: gifSettings.boomerang,
      maxColors: gifSettings.colors,
    });
    gifEncoderStatus = "ready";

    const off = document.createElement("canvas");
    off.width = size.width;
    off.height = size.height;
    const offCtx = off.getContext("2d", { willReadFrequently: true })!;

    for (let i = 0; i < frameCount; i++) {
      const timeUs = frameToStartTimeUs(i, { numerator: fps, denominator: 1 });
      const gifProject = session.getProject();
      const visual = (
        gifProject ? resolveAtTimeDeep(gifProject, seq.id, timeUs) : []
      ).filter((l) => {
        const a = findAsset(l.assetId);
        return a && a.kind !== "audio";
      });
      offCtx.clearRect(0, 0, off.width, off.height);
      for (const layer of [...visual].reverse()) {
        const loc = locateClipAnywhere(layer.clipId);
        if (!loc) continue;
        const asset = findAsset(loc.clip.assetId);
        const media = asset ? mediaFor(asset) : undefined;
        if (media instanceof HTMLVideoElement) {
          await seekVideoFrame(media, Number(layer.sourceTimeUs) / 1_000_000);
        }
        paintLayer(
          offCtx,
          loc.clip,
          layer.sourceTimeUs,
          clipLocalTimeUs(timeUs, layer.timelineStartUs),
          off.width,
          off.height,
        );
      }
      // GIF has 1-bit alpha: without this a clip animated with
      // transform.opacity exports at full strength and the fade is lost.
      const frame = offCtx.getImageData(0, 0, off.width, off.height);
      flattenPartialAlpha(frame.data);
      sink.addFrame(frame);

      if (i % GIF_YIELD_EVERY === 0) {
        status.textContent = `Rendering frame ${i + 1} of ${frameCount}…`;
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    status.textContent = "Encoding GIF…";
    await new Promise((r) => setTimeout(r, 0));
    const blob = sink.finish();
    downloadBlob(blob, "export.gif");
    const kb = Math.round(blob.size / 1024);
    toast(`Exported ${size.width}×${size.height} GIF · ${kb} KB.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!isGifEncoderLoaded()) gifEncoderStatus = "failed";
    toast(`GIF export failed: ${message}`, true);
  } finally {
    gifExportInFlight = false;
    renderOriginals = false;
    exportActive = false;
    resumeProxies();
    renderGifPanel();
  }
}

function bindGifPanel(): void {
  const fps = $<HTMLInputElement>("gif-fps");
  const width = $<HTMLInputElement>("gif-width");
  const colors = $<HTMLSelectElement>("gif-colors");
  const loop = $<HTMLInputElement>("gif-loop");
  const boomerang = $<HTMLInputElement>("gif-boomerang");

  const update = (patch: Partial<GifSettings>): void => {
    gifSettings = { ...gifSettings, ...patch };
    renderGifPanel();
  };

  fps.addEventListener("input", () => update({ fps: Number(fps.value) }));
  width.addEventListener("input", () => update({ width: Number(width.value) }));
  colors.addEventListener("change", () =>
    update({ colors: Number(colors.value) }),
  );
  loop.addEventListener("change", () => update({ loop: loop.checked }));
  boomerang.addEventListener("change", () =>
    update({ boomerang: boomerang.checked }),
  );
  $("btn-gif-export").addEventListener("click", () => void runGifExport());
}

function doExport(): void {
  if (mode === "photo") {
    void exportPhotoImage();
    return;
  }
  if (mode === "gif") {
    void runGifExport();
    return;
  }
  openExportModal();
}

// ==========================================================================
// Bootstrap
// ==========================================================================
configureOnnxRuntime({ wasm: ortWasmUrl, mjs: ortMjsUrl });
seed();
// The seed (project + sequence + tracks) is app scaffolding, not a user edit —
// clear history so Undo can never pop it and null the project (which made
// later imports fail with "no project exists").
// The seed (project + sequence + tracks) stays in the log — it is what makes a
// saved file replayable from scratch — with a floor under Undo so it can never
// be popped, which is what nulled the project and broke later imports.
session.markBaseline();
bindEvents();
initTheme();
setMode("photo");
updateUI();
requestAnimationFrame(animate);
