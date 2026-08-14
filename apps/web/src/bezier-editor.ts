import type { CubicBezier } from "@director/project-schema";

/**
 * Drawing an easing curve by hand.
 *
 * The named easings cover the ordinary cases and one thing they cannot do at
 * all: overshoot. A move that goes slightly past its target and settles is what
 * makes an animation feel physical rather than mechanical, and no combination
 * of ease-in and ease-out produces it — the curve has to leave the 0–1 range.
 *
 * So the editor's vertical axis extends past the unit square on both sides, and
 * the region outside it is drawn rather than hidden. A curve that overshoots is
 * the point of the feature; an editor that clipped it would make the feature
 * look broken.
 *
 * Horizontally there is no such freedom. `x` is time, and a control point
 * outside 0–1 would let the curve double back so one instant had two values.
 * That is why `clampControlPoint` treats the two axes differently — it is the
 * CSS rule, and it is the schema's rule, for the same reason.
 */

/** How far past the unit square the vertical axis reaches, so an overshooting
 * curve is visible rather than clipped at the edge of the box. */
export const OVERSHOOT_MARGIN = 0.6;
export const Y_MIN = -OVERSHOOT_MARGIN;
export const Y_MAX = 1 + OVERSHOOT_MARGIN;

/** Padding inside the canvas, in pixels, so handles at the corners are still
 * fully drawn and grabbable rather than half outside the element. */
const PAD = 18;

/** How close a pointer must come to a handle to grab it, in pixels. Larger than
 * the drawn handle: the drawn size is what reads well, this is what a person
 * can reliably hit, and they are not the same number. */
const GRAB_RADIUS = 18;

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Curve space (x 0–1, y unbounded) to canvas pixels. */
export function toCanvas(point: Point, view: Viewport): Point {
  const plotWidth = view.width - PAD * 2;
  const plotHeight = view.height - PAD * 2;
  return {
    x: PAD + point.x * plotWidth,
    // Inverted: canvas y grows downward, and a curve drawn upside down would
    // make ease-in look like ease-out.
    y: PAD + (1 - (point.y - Y_MIN) / (Y_MAX - Y_MIN)) * plotHeight,
  };
}

/** Canvas pixels back to curve space. */
export function fromCanvas(point: Point, view: Viewport): Point {
  const plotWidth = view.width - PAD * 2;
  const plotHeight = view.height - PAD * 2;
  return {
    x: (point.x - PAD) / plotWidth,
    y: Y_MIN + (1 - (point.y - PAD) / plotHeight) * (Y_MAX - Y_MIN),
  };
}

/**
 * Constrain a dragged control point to what the schema will accept.
 *
 * `x` is clamped to 0–1 because it is time. `y` is clamped only to the visible
 * range, and only so a handle cannot be dragged somewhere it stops being drawn
 * — the schema itself puts no bound on `y`, and shouldn't.
 */
export function clampControlPoint(point: Point): Point {
  return {
    x: Math.min(1, Math.max(0, point.x)),
    y: Math.min(Y_MAX, Math.max(Y_MIN, point.y)),
  };
}

/** Which handle a press grabs, or null. The second is tested first so that two
 * handles resting on top of each other stay separable — otherwise the first
 * always wins and the second can never be moved off it again. */
export function handleAt(
  press: Point,
  bezier: CubicBezier,
  view: Viewport,
): 1 | 2 | null {
  const second = toCanvas({ x: bezier.x2, y: bezier.y2 }, view);
  if (Math.hypot(press.x - second.x, press.y - second.y) <= GRAB_RADIUS)
    return 2;
  const first = toCanvas({ x: bezier.x1, y: bezier.y1 }, view);
  if (Math.hypot(press.x - first.x, press.y - first.y) <= GRAB_RADIUS) return 1;
  return null;
}

/** Move one handle, returning a new curve. */
export function withHandle(
  bezier: CubicBezier,
  handle: 1 | 2,
  point: Point,
): CubicBezier {
  const next = clampControlPoint(point);
  return handle === 1
    ? { ...bezier, x1: next.x, y1: next.y }
    : { ...bezier, x2: next.x, y2: next.y };
}

/** A point on the curve at parameter `t` — not at time `t`; the two differ for
 * every curve that is not linear, which is the whole point of easing. */
export function curvePoint(bezier: CubicBezier, t: number): Point {
  // The endpoints are fixed at (0,0) and (1,1), so the first basis term drops
  // out entirely and the last contributes its coefficient unweighted.
  const inverse = 1 - t;
  const b = 3 * inverse * inverse * t;
  const c = 3 * inverse * t * t;
  const d = t * t * t;
  return {
    x: b * bezier.x1 + c * bezier.x2 + d,
    y: b * bezier.y1 + c * bezier.y2 + d,
  };
}

/** The control points of a named easing, so opening the editor starts from the
 * curve the keyframe is already using rather than from a straight line. */
export const NAMED_CURVES: Readonly<Record<string, CubicBezier>> = {
  linear: { x1: 0, y1: 0, x2: 1, y2: 1 },
  "ease-in": { x1: 0.42, y1: 0, x2: 1, y2: 1 },
  "ease-out": { x1: 0, y1: 0, x2: 0.58, y2: 1 },
  "ease-in-out": { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
  hold: { x1: 1, y1: 0, x2: 1, y2: 0 },
};

export function curveForEasing(easing: string): CubicBezier {
  return NAMED_CURVES[easing] ?? NAMED_CURVES["ease-in-out"]!;
}

/** Whether a curve leaves the unit square, which is worth telling the user:
 * overshoot is usually deliberate, but it is also what an accidental drag
 * produces, and the two look identical until the animation runs. */
export function overshoots(bezier: CubicBezier): boolean {
  return bezier.y1 < 0 || bezier.y1 > 1 || bezier.y2 < 0 || bezier.y2 > 1;
}

/** Paint the curve, its handles, and the unit square. */
export function drawCurve(
  context: CanvasRenderingContext2D,
  bezier: CubicBezier,
  view: Viewport,
): void {
  const { width, height } = view;
  context.clearRect(0, 0, width, height);

  const topLeft = toCanvas({ x: 0, y: 1 }, view);
  const bottomRight = toCanvas({ x: 1, y: 0 }, view);

  // The unit square: where the value starts and where it ends. Without it an
  // overshooting curve has nothing to overshoot *against* and just looks steep.
  context.fillStyle = "rgba(127, 127, 127, 0.10)";
  context.fillRect(
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y,
  );
  context.strokeStyle = "rgba(127, 127, 127, 0.45)";
  context.lineWidth = 1;
  context.strokeRect(
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y,
  );

  const start = toCanvas({ x: 0, y: 0 }, view);
  const end = toCanvas({ x: 1, y: 1 }, view);
  const first = toCanvas({ x: bezier.x1, y: bezier.y1 }, view);
  const second = toCanvas({ x: bezier.x2, y: bezier.y2 }, view);

  // Handle arms, so it is clear which endpoint each handle belongs to.
  context.strokeStyle = "rgba(127, 127, 127, 0.7)";
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(first.x, first.y);
  context.moveTo(end.x, end.y);
  context.lineTo(second.x, second.y);
  context.stroke();

  context.strokeStyle = "#2bb3a3";
  context.lineWidth = 2.5;
  context.beginPath();
  const STEPS = 64;
  for (let step = 0; step <= STEPS; step += 1) {
    const point = toCanvas(curvePoint(bezier, step / STEPS), view);
    if (step === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.stroke();

  for (const [point, fill] of [
    [first, "#6c7bf5"],
    [second, "#f5896c"],
  ] as const) {
    context.beginPath();
    context.arc(point.x, point.y, 7, 0, Math.PI * 2);
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = "rgba(255, 255, 255, 0.9)";
    context.lineWidth = 2;
    context.stroke();
  }
}
