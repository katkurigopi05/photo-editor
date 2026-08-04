export type VectorShapeKind = "circle" | "star" | "speech-bubble";

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
