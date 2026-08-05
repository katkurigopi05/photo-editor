export type VectorShapeKind =
  | "circle"
  | "star"
  | "speech-bubble"
  | "rectangle"
  | "triangle"
  | "arrow"
  | "heart";

export interface VectorShapePreset {
  id: VectorShapeKind;
  label: string;
  symbol: string;
  fillHex: string;
  strokeHex: string;
}

export const VECTOR_SHAPE_PRESETS: readonly VectorShapePreset[] = [
  {
    id: "circle",
    label: "Circle",
    symbol: "●",
    fillHex: "#7c5cff",
    strokeHex: "#ffffff",
  },
  {
    id: "star",
    label: "Star",
    symbol: "★",
    fillHex: "#ffcc00",
    strokeHex: "#402000",
  },
  {
    id: "speech-bubble",
    label: "Speech Bubble",
    symbol: "▰",
    fillHex: "#ffffff",
    strokeHex: "#202638",
  },
  {
    id: "rectangle",
    label: "Rectangle",
    symbol: "▮",
    fillHex: "#39d3a5",
    strokeHex: "#0d3b2e",
  },
  {
    id: "triangle",
    label: "Triangle",
    symbol: "▲",
    fillHex: "#ff7a5c",
    strokeHex: "#3d1206",
  },
  {
    id: "arrow",
    label: "Arrow",
    symbol: "➤",
    fillHex: "#4aa8ff",
    strokeHex: "#062944",
  },
  {
    id: "heart",
    label: "Heart",
    symbol: "♥",
    fillHex: "#ff5c8a",
    strokeHex: "#4a0d22",
  },
];

export interface VectorShapeSpec {
  kind: VectorShapeKind;
  fillHex: string;
  strokeHex: string;
  width: number;
  height: number;
}

export interface VectorShapeSource {
  svg: string;
  dataUri: string;
  byteLength: number;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_DIMENSION = 4096;

function validateSpec(spec: VectorShapeSpec): void {
  if (!HEX_COLOR.test(spec.fillHex) || !HEX_COLOR.test(spec.strokeHex)) {
    throw new RangeError("vector shape colors must use #RRGGBB");
  }
  if (
    !Number.isInteger(spec.width) ||
    !Number.isInteger(spec.height) ||
    spec.width < 1 ||
    spec.height < 1 ||
    spec.width > MAX_DIMENSION ||
    spec.height > MAX_DIMENSION
  ) {
    throw new RangeError(
      `vector shape dimensions must be integers from 1 to ${MAX_DIMENSION}`,
    );
  }
}

function n(value: number): number {
  return Math.round(value);
}

function shapeMarkup(spec: VectorShapeSpec, strokeWidth: number): string {
  const { width: w, height: h, fillHex: fill, strokeHex: stroke } = spec;
  const common = `fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" vector-effect="non-scaling-stroke"`;
  switch (spec.kind) {
    case "circle":
      return `<ellipse cx="${n(w * 0.5)}" cy="${n(h * 0.5)}" rx="${n(w * 0.38)}" ry="${n(h * 0.38)}" ${common}/>`;
    case "star": {
      const points = [
        [0.5, 0.08],
        [0.62, 0.36],
        [0.92, 0.38],
        [0.69, 0.58],
        [0.77, 0.9],
        [0.5, 0.72],
        [0.23, 0.9],
        [0.31, 0.58],
        [0.08, 0.38],
        [0.38, 0.36],
      ]
        .map(([x, y]) => `${n(w * x!)},${n(h * y!)}`)
        .join(" ");
      return `<polygon points="${points}" ${common}/>`;
    }
    case "rectangle":
      return `<rect x="${n(w * 0.14)}" y="${n(h * 0.2)}" width="${n(w * 0.72)}" height="${n(h * 0.6)}" rx="${n(Math.min(w, h) * 0.06)}" ${common}/>`;
    case "triangle":
      return `<polygon points="${n(w * 0.5)},${n(h * 0.12)} ${n(w * 0.9)},${n(h * 0.85)} ${n(w * 0.1)},${n(h * 0.85)}" ${common}/>`;
    case "arrow":
      return `<polygon points="${n(w * 0.08)},${n(h * 0.4)} ${n(w * 0.56)},${n(h * 0.4)} ${n(w * 0.56)},${n(h * 0.22)} ${n(w * 0.94)},${n(h * 0.5)} ${n(w * 0.56)},${n(h * 0.78)} ${n(w * 0.56)},${n(h * 0.6)} ${n(w * 0.08)},${n(h * 0.6)}" ${common}/>`;
    case "heart":
      return `<path d="M ${n(w * 0.5)} ${n(h * 0.86)} C ${n(w * 0.16)} ${n(h * 0.62)} ${n(w * 0.1)} ${n(h * 0.34)} ${n(w * 0.28)} ${n(h * 0.22)} C ${n(w * 0.4)} ${n(h * 0.14)} ${n(w * 0.5)} ${n(h * 0.24)} ${n(w * 0.5)} ${n(h * 0.32)} C ${n(w * 0.5)} ${n(h * 0.24)} ${n(w * 0.6)} ${n(h * 0.14)} ${n(w * 0.72)} ${n(h * 0.22)} C ${n(w * 0.9)} ${n(h * 0.34)} ${n(w * 0.84)} ${n(h * 0.62)} ${n(w * 0.5)} ${n(h * 0.86)} Z" ${common}/>`;
    case "speech-bubble":
      return `<path d="M ${n(w * 0.14)} ${n(h * 0.14)} H ${n(w * 0.86)} Q ${n(w * 0.94)} ${n(h * 0.14)} ${n(w * 0.94)} ${n(h * 0.24)} V ${n(h * 0.67)} Q ${n(w * 0.94)} ${n(h * 0.77)} ${n(w * 0.84)} ${n(h * 0.77)} H ${n(w * 0.45)} L ${n(w * 0.25)} ${n(h * 0.92)} L ${n(w * 0.29)} ${n(h * 0.77)} H ${n(w * 0.14)} Q ${n(w * 0.06)} ${n(h * 0.77)} ${n(w * 0.06)} ${n(h * 0.67)} V ${n(h * 0.24)} Q ${n(w * 0.06)} ${n(h * 0.14)} ${n(w * 0.14)} ${n(h * 0.14)} Z" ${common}/>`;
  }
}

/** Build a standalone SVG image. The data URI remains valid in serialized
 * projects, unlike an object URL, and browsers can draw it through the same
 * CanvasImageSource path used for imported photos. */
export function createVectorShapeSource(
  spec: VectorShapeSpec,
): VectorShapeSource {
  validateSpec(spec);
  const label = `Cartoon ${spec.kind.replaceAll("-", " ")}`;
  const strokeWidth = Math.max(2, n(Math.min(spec.width, spec.height) * 0.035));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" ` +
    `viewBox="0 0 ${spec.width} ${spec.height}" role="img" aria-label="${label}">` +
    shapeMarkup(spec, strokeWidth) +
    "</svg>";
  return {
    svg,
    dataUri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    byteLength: new TextEncoder().encode(svg).length,
  };
}
