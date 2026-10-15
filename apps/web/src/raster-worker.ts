import {
  type RasterImage,
  oilPainting,
  pencilSketch,
  cartoonPosterize,
  watercolor,
  crosshatch,
  halftone,
  clarity,
  texture,
  dehaze,
  noiseReduction,
  unsharpMask,
} from "@director/raster-tools";

/**
 * Dedicated Web Worker executing heavy CPU raster algorithms off the main thread.
 *
 * Compute-intensive operations (such as Oil Painting, Clarity, Dehaze, and
 * Halftone) perform multi-pass 2D convolutions and histogram bins that take
 * 100-600ms on high-resolution frames. Offloading them here ensures the browser's
 * main UI thread remains fluid at 60 fps without dropped frames.
 */

export type RasterWorkerOperation =
  | "oilPainting"
  | "pencilSketch"
  | "cartoonPosterize"
  | "watercolor"
  | "crosshatch"
  | "halftone"
  | "clarity"
  | "texture"
  | "dehaze"
  | "noiseReduction"
  | "unsharpMask";

export interface RasterWorkerRequest {
  id: string;
  operation: RasterWorkerOperation;
  width: number;
  height: number;
  data: ArrayBuffer;
  params?: Record<string, number | boolean | string | undefined>;
}

export type RasterWorkerResponse =
  | {
      id: string;
      type: "done";
      width: number;
      height: number;
      data: ArrayBuffer;
      durationMs: number;
    }
  | {
      id: string;
      type: "error";
      message: string;
    };

export function executeRasterOperation(
  operation: RasterWorkerOperation,
  image: RasterImage,
  params: Record<string, number | boolean | string | undefined> = {},
): RasterImage {
  switch (operation) {
    case "oilPainting":
      return oilPainting(
        image,
        typeof params.radiusPx === "number" ? params.radiusPx : 4,
      );
    case "pencilSketch":
      return pencilSketch(
        image,
        typeof params.strength === "number" ? params.strength : 0.8,
        typeof params.grain === "number" ? params.grain : 0.2,
      );
    case "cartoonPosterize":
      return cartoonPosterize(
        image,
        typeof params.levels === "number" ? params.levels : 4,
        typeof params.edgeStrength === "number" ? params.edgeStrength : 0.7,
      );
    case "watercolor":
      return watercolor(
        image,
        typeof params.poolRadiusPx === "number" ? params.poolRadiusPx : 4,
        typeof params.edgeStrength === "number" ? params.edgeStrength : 0.5,
        typeof params.grain === "number" ? params.grain : 0.2,
      );
    case "crosshatch":
      return crosshatch(
        image,
        typeof params.spacingPx === "number" ? params.spacingPx : 6,
        typeof params.darkness === "number" ? params.darkness : 0.8,
      );
    case "halftone":
      return halftone(
        image,
        typeof params.cellPx === "number" ? params.cellPx : 6,
        typeof params.angleDegrees === "number" ? params.angleDegrees : 45,
      );
    case "clarity":
      return clarity(
        image,
        typeof params.amount === "number" ? params.amount : 0,
      );
    case "texture":
      return texture(
        image,
        typeof params.amount === "number" ? params.amount : 0,
      );
    case "dehaze":
      return dehaze(
        image,
        typeof params.amount === "number" ? params.amount : 0,
      );
    case "noiseReduction":
      return noiseReduction(
        image,
        typeof params.luminance === "number" ? params.luminance : 0,
        typeof params.chrominance === "number" ? params.chrominance : 0,
      );
    case "unsharpMask":
      return unsharpMask(
        image,
        typeof params.amount === "number" ? params.amount : 1.0,
        typeof params.radiusPx === "number" ? params.radiusPx : 1,
      );
    default: {
      const exhaustiveCheck: never = operation;
      throw new Error(`Unsupported raster worker operation: ${exhaustiveCheck}`);
    }
  }
}

// Only bind self.onmessage when running inside a dedicated worker context
if (typeof self !== "undefined" && typeof self.postMessage === "function") {
  self.onmessage = (event: MessageEvent<RasterWorkerRequest>) => {
    const { id, operation, width, height, data, params = {} } = event.data;
    const t0 = performance.now();

    try {
      const inputImage: RasterImage = {
        width,
        height,
        data: new Uint8ClampedArray(data),
      };

      const result = executeRasterOperation(operation, inputImage, params);
      const durationMs = performance.now() - t0;

      // Transfer the buffer back to the main thread with zero memory copying
      const transferBuffer = result.data.buffer as ArrayBuffer;
      const response: RasterWorkerResponse = {
        id,
        type: "done",
        width: result.width,
        height: result.height,
        data: transferBuffer,
        durationMs,
      };

      (self as unknown as Worker).postMessage(response, [transferBuffer]);
    } catch (error) {
      const response: RasterWorkerResponse = {
        id,
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      };
      (self as unknown as Worker).postMessage(response);
    }
  };
}
