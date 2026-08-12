export {
  type RasterImage,
  type Mask,
  type RgbColor,
  createImage,
  cloneImage,
  createMask,
  pixelIndex,
  inBounds,
} from "./types.js";

export {
  type CurvePoint,
  type CurveSet,
  IDENTITY_CURVE,
  curvePoint,
  buildCurveLut,
  applyCurves,
} from "./curves.js";

export {
  type Point,
  polygonMask,
  floodFillMask,
  invertMask,
  featherMask,
  maskBounds,
  linearGradientMask,
  radialGradientMask,
  brushStrokeMask,
  luminanceRangeMask,
  colorRangeMask,
} from "./mask.js";

export {
  type RgbaColor,
  stampBrush,
  cloneStamp,
  applyMaskDelete,
  applyMaskFill,
} from "./paint.js";

export {
  boxBlurRgb,
  unsharpMask,
  diffusionFill,
  colorKeyAlpha,
  cornerKeyColor,
} from "./filters.js";

export {
  type Rect,
  cropImage,
  resizeImage,
  rotateImage,
  shiftImage,
} from "./transform.js";

export {
  grainAt,
  pencilSketch,
  oilPainting,
  cartoonPosterize,
  watercolor,
  crosshatch,
  halftone,
} from "./artistic.js";

export { whiteBalance, levels, toneCurve } from "./grade.js";

// Lightroom-modelled adjustments. `vibrance` lives here rather than in
// `grade.ts` because both modules had one and this is the mask-aware version;
// the grading effect calls it with its −1…1 amount scaled to Lightroom's
// −100…100 convention.
export {
  type HslAdjustment,
  type HslBand,
  type MaskMode,
  HSL_BANDS,
  blacks,
  colorMixer,
  composeMasks,
  contrast,
  exposure,
  highlights,
  hslToRgb,
  luma,
  mapPixels,
  rgbToHsl,
  saturation,
  shadows,
  temperature,
  tint,
  vibrance,
  whites,
  colorGrading,
  type ColorGradingOptions,
  type GradingWheel,
} from "./adjust.js";

export { clarity, texture, dehaze, noiseReduction } from "./detail.js";
