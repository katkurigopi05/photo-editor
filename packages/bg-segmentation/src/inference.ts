// The WASM-only build (no WebGL/WebGPU code pulled in) — matches the single
// wasm execution provider used below and keeps the bundle to one ~13 MB
// binary instead of ~76 MB across every backend variant.
import * as ort from "onnxruntime-web/wasm";
import type { Mask, RasterImage } from "@director/raster-tools";
import { preprocessU2Net } from "./preprocess.js";
import { postprocessU2Net } from "./postprocess.js";

export interface SegmentationModel {
  name: "u2netp" | "u2net";
  /** Bundled assets are same-origin (served by our own app) and trusted by
   * construction. External URLs must carry `sha256` — real subject-identity
   * verification of every byte before it's ever executed as WASM/ONNX. */
  url: string;
  inputSize: number;
  sha256?: string;
  /** Human-readable size, for UI copy before a lazy download starts. */
  approxSizeMb: number;
}

/** Bundled with the app (~4.4 MB) — the default, fast model. Real U²-Net-p
 * weights (Xuebin Qin et al., Apache-2.0), downloaded directly from rembg's
 * own release assets and MD5-verified at build time against the checksum
 * rembg itself publishes in its source. */
export const U2NETP_MODEL: SegmentationModel = {
  name: "u2netp",
  url: "/models/u2netp.onnx",
  inputSize: 320,
  approxSizeMb: 4.4,
};

/** Not bundled (167.8 MB, exceeds GitHub's 100 MB push limit) — fetched once
 * on demand and cached by the browser's Cache Storage, then verified against
 * a SHA-256 computed independently from a full download of the exact file
 * (its MD5 was also cross-checked against the checksum rembg itself
 * publishes: 60024c5c889badc19c04ad937298a77b — confirmed matching) before
 * any inference runs on it. Same architecture as u2netp, higher accuracy. */
export const U2NET_MODEL: SegmentationModel = {
  name: "u2net",
  url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx",
  inputSize: 320,
  sha256: "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491",
  approxSizeMb: 167.8,
};

const MODEL_CACHE_NAME = "director-bg-segmentation-models-v1";
const sessionCache = new Map<string, Promise<ort.InferenceSession>>();

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifySha256(
  buffer: ArrayBuffer,
  expectedHex: string,
): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const actual = bytesToHex(digest);
  if (actual !== expectedHex) {
    throw new Error(
      `Model checksum mismatch (expected ${expectedHex}, got ${actual}) — refusing to run an unverified model.`,
    );
  }
}

/** Fetch a model, verifying its checksum before first use and caching the
 * verified bytes in the browser's Cache Storage so it's only downloaded once
 * per model version, ever. */
async function fetchVerified(model: SegmentationModel): Promise<ArrayBuffer> {
  const cache = await caches.open(MODEL_CACHE_NAME);
  const cached = await cache.match(model.url);
  if (cached) return cached.arrayBuffer();

  const response = await fetch(model.url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch model "${model.name}": HTTP ${response.status}`,
    );
  }
  const buffer = await response.arrayBuffer();
  if (model.sha256) {
    await verifySha256(buffer, model.sha256);
  }
  await cache.put(model.url, new Response(buffer.slice(0)));
  return buffer;
}

async function loadSession(
  model: SegmentationModel,
): Promise<ort.InferenceSession> {
  const cached = sessionCache.get(model.name);
  if (cached) return cached;
  const promise = (async () => {
    const options: ort.InferenceSession.SessionOptions = {
      executionProviders: ["wasm"],
    };
    if (model.sha256) {
      const buffer = await fetchVerified(model);
      return ort.InferenceSession.create(new Uint8Array(buffer), options);
    }
    return ort.InferenceSession.create(model.url, options);
  })();
  sessionCache.set(model.name, promise);
  return promise;
}

export interface SegmentationProgress {
  stage: "loading-model" | "preprocessing" | "running" | "postprocessing";
}

/** Run real U²-Net-family foreground segmentation and return a selection
 * mask the same shape the rest of the raster toolset already understands —
 * so it composites via the existing applyMaskDelete/applyMaskFill/
 * featherMask, exactly like a Lasso or Magic Wand selection. */
export async function segmentForeground(
  image: RasterImage,
  model: SegmentationModel = U2NETP_MODEL,
  onProgress?: (progress: SegmentationProgress) => void,
): Promise<Mask> {
  onProgress?.({ stage: "loading-model" });
  const session = await loadSession(model);

  onProgress?.({ stage: "preprocessing" });
  const inputData = preprocessU2Net(image, model.inputSize);
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) {
    throw new Error(
      `Model "${model.name}" exposes no usable input/output tensors.`,
    );
  }

  onProgress?.({ stage: "running" });
  const feeds: Record<string, ort.Tensor> = {
    [inputName]: new ort.Tensor("float32", inputData, [
      1,
      3,
      model.inputSize,
      model.inputSize,
    ]),
  };
  const results = await session.run(feeds);
  const outputTensor = results[outputName];
  if (!outputTensor) {
    throw new Error(
      `Model "${model.name}" produced no output for tensor "${outputName}".`,
    );
  }

  onProgress?.({ stage: "postprocessing" });
  return postprocessU2Net(
    outputTensor.data as Float32Array,
    model.inputSize,
    image.width,
    image.height,
  );
}

/**
 * Point onnxruntime-web at explicit, already-resolved URLs for its .wasm
 * binary and .mjs loader, instead of letting it construct a path itself.
 *
 * Bundlers (Vite in dev mode especially) cannot apply their module
 * transform/serving pipeline to a path onnxruntime-web builds at runtime by
 * string concatenation — the dynamic `import()` of that computed path 404s
 * (or, worse, silently resolves to an HTML fallback page, which then fails
 * `WebAssembly.instantiate` with a "bad magic number" error). Passing exact
 * URLs the caller resolved via its own bundler's asset-URL import syntax
 * (e.g. Vite's `?url` suffix) sidesteps that entirely.
 */
export function configureOnnxRuntime(paths: {
  wasm: string;
  mjs: string;
}): void {
  ort.env.wasm.wasmPaths = paths;
}
