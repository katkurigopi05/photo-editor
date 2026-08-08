/**
 * Proxy media.
 *
 * Editing against a 4K source means decoding a 4K frame for every scrub, every
 * playhead move and every redraw, which is why large files feel broken long
 * before they run out of memory. Every professional editor answers this the
 * same way: transcode once to a small, cheaply-decoded copy, edit against that,
 * and go back to the original at export. Nothing about the project changes —
 * a proxy is a cache, not an edit, so it never enters the command log.
 *
 * Proxies live in the origin-private file system rather than IndexedDB: a proxy
 * of a long clip is hundreds of megabytes, and OPFS takes a write stream, so
 * the file is never held in memory whole. They are keyed by the source's
 * checksum, so reopening a project — or importing the same footage twice —
 * finds the proxy already built.
 */

import { Muxer, FileSystemWritableFileStreamTarget } from "mp4-muxer";
import { h264CodecString } from "./export-preset.js";

/** Proxy picture height. 540 is the usual choice: a quarter of the pixels of
 * 1080p, still enough to frame a cut on. */
export const PROXY_HEIGHT = 540;

/** Proxy frame rate. Above this a proxy stops being cheap to decode, and no
 * editing decision needs more. */
export const PROXY_FPS = 30;

/** Sources at or above this height are worth proxying. Below it the source is
 * already about as cheap as its proxy would be. */
export const PROXY_MIN_HEIGHT = 720;

/** …as is anything this large, whatever its dimensions: a long clip is slow to
 * seek through even at modest resolution. */
export const PROXY_MIN_BYTES = 256 * 1024 * 1024;

const PROXY_DIR = "proxies";

export interface Size {
  width: number;
  height: number;
}

/**
 * The proxy's dimensions for a given source.
 *
 * Aspect is preserved and both sides are rounded to even numbers, because H.264
 * encodes in 2x2 chroma blocks and an odd dimension is rejected outright by
 * some encoders. A source already shorter than the target is copied at its own
 * size rather than upscaled — a bigger proxy than source would be slower than
 * no proxy at all.
 */
export function proxySize(
  width: number,
  height: number,
  targetHeight: number = PROXY_HEIGHT,
): Size {
  const even = (value: number): number => Math.max(2, Math.round(value / 2) * 2);
  if (height <= targetHeight) return { width: even(width), height: even(height) };
  return {
    width: even((width * targetHeight) / height),
    height: even(targetHeight),
  };
}

/** Whether a source is worth proxying at all. */
export function shouldBuildProxy(source: {
  kind: string;
  width?: number;
  height?: number;
  fileSizeBytes?: number;
}): boolean {
  if (source.kind !== "video") return false;
  if ((source.fileSizeBytes ?? 0) >= PROXY_MIN_BYTES) return true;
  return (source.height ?? 0) >= PROXY_MIN_HEIGHT;
}

/**
 * Proxy bitrate.
 *
 * Scaled to the picture rather than fixed, at roughly 0.1 bits per pixel per
 * frame — enough that the proxy is not visibly mushy while staying a fraction
 * of the source. A proxy that looks wrong is one people turn off.
 */
export function proxyBitrateKbps(width: number, height: number): number {
  const bits = width * height * PROXY_FPS * 0.1;
  return Math.max(500, Math.round(bits / 1000));
}

async function proxyDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(PROXY_DIR, { create: true });
}

/** The proxy already built for this source, if there is one. */
export async function readProxy(checksum: string): Promise<File | null> {
  try {
    const dir = await proxyDirectory();
    const handle = await dir.getFileHandle(`${checksum}.mp4`);
    const file = await handle.getFile();
    // A build interrupted by a closed tab leaves a stub behind; treating it as
    // a proxy would render every frame black.
    return file.size > 0 ? file : null;
  } catch {
    return null;
  }
}

/** Throw away every proxy. Sources are untouched — this only costs time. */
export async function clearProxies(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(PROXY_DIR, { recursive: true });
  } catch {
    // Nothing built yet, or no OPFS: either way there is nothing to clear.
  }
}

/** Total bytes the proxy store is holding. */
export async function proxyStoreBytes(): Promise<number> {
  try {
    const dir = await proxyDirectory();
    let total = 0;
    // `values()` is an async iterator over the directory's handles; the DOM lib
    // in this TypeScript version does not declare it.
    const entries = (dir as unknown as {
      values: () => AsyncIterable<FileSystemHandle>;
    }).values();
    for await (const handle of entries) {
      if (handle.kind !== "file") continue;
      total += (await (handle as FileSystemFileHandle).getFile()).size;
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Wait for a video element to have the frame at `seconds` decoded and painted.
 *
 * `seeked` fires when the seek completes, which is not the same as the frame
 * being available to `drawImage` — hence the frame callback where the browser
 * has one. Getting this wrong does not fail loudly; it silently encodes the
 * previous frame, so a proxy would drift out of sync with its source.
 */
function seekTo(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const onSeeked = (): void => {
      video.removeEventListener("seeked", onSeeked);
      if (typeof video.requestVideoFrameCallback !== "function") {
        finish();
        return;
      }
      video.requestVideoFrameCallback(() => finish());
      // A paused element may never present another frame; the seek itself is
      // the guarantee the data is there.
      setTimeout(finish, 120);
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = seconds;
  });
}

export interface BuildProxyOptions {
  checksum: string;
  durationUs: string;
  /** Called with 0..1 as frames are encoded. */
  onProgress?: (fraction: number) => void;
  /** Checked between frames; a true return abandons the build. */
  cancelled?: () => boolean;
}

/**
 * Transcode a source element into a proxy file.
 *
 * The source is decoded by seeking a plain video element, which is the only
 * decode path a browser offers for an arbitrary file it can play. That makes
 * building a proxy roughly as slow as an export — paid once, against every
 * scrub afterwards.
 *
 * Returns null when the browser has no WebCodecs, when the encoder refuses the
 * configuration, or when the build was cancelled. A missing proxy is not an
 * error: everything still works, just against the original.
 */
export async function buildProxy(
  source: HTMLVideoElement,
  options: BuildProxyOptions,
): Promise<File | null> {
  if (typeof VideoEncoder === "undefined") return null;
  const width = source.videoWidth;
  const height = source.videoHeight;
  if (!width || !height) return null;

  const size = proxySize(width, height);
  const codec = h264CodecString(size.width, size.height, PROXY_FPS);
  const config: VideoEncoderConfig = {
    codec,
    width: size.width,
    height: size.height,
    bitrate: proxyBitrateKbps(size.width, size.height) * 1000,
    framerate: PROXY_FPS,
  };
  const support = await VideoEncoder.isConfigSupported(config).catch(() => null);
  if (!support?.supported) return null;

  const dir = await proxyDirectory();
  const handle = await dir.getFileHandle(`${options.checksum}.mp4`, {
    create: true,
  });
  const writable = await handle.createWritable();

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  let encodeError: Error | null = null;
  const muxer = new Muxer({
    target: new FileSystemWritableFileStreamTarget(writable),
    video: {
      codec: "avc",
      width: size.width,
      height: size.height,
      frameRate: PROXY_FPS,
    },
    // Streamed, so the index lands at the end of the file. Nothing but this
    // app ever opens a proxy, and it opens it from disk.
    fastStart: false,
  });
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      encodeError = err instanceof Error ? err : new Error(String(err));
    },
  });
  encoder.configure(config);

  const durationSeconds = Number(options.durationUs) / 1_000_000;
  const frames = Math.max(1, Math.round(durationSeconds * PROXY_FPS));
  const frameUs = Math.round(1_000_000 / PROXY_FPS);
  const wasMuted = source.muted;
  source.muted = true;

  try {
    for (let index = 0; index < frames; index++) {
      if (options.cancelled?.()) {
        encoder.close();
        await writable.close();
        await dir.removeEntry(`${options.checksum}.mp4`).catch(() => undefined);
        return null;
      }
      await seekTo(source, Math.min(index / PROXY_FPS, durationSeconds));
      ctx.drawImage(source, 0, 0, size.width, size.height);
      const frame = new VideoFrame(canvas, {
        timestamp: index * frameUs,
        duration: frameUs,
      });
      // A keyframe every second: scrubbing a proxy is exactly the workload
      // long GOPs are worst at.
      encoder.encode(frame, { keyFrame: index % PROXY_FPS === 0 });
      frame.close();
      if (encodeError) throw encodeError;
      options.onProgress?.((index + 1) / frames);
      // Yield often enough that the page stays usable while this runs.
      if (index % 10 === 9) await new Promise((r) => setTimeout(r, 0));
    }
    await encoder.flush();
    encoder.close();
    muxer.finalize();
    await writable.close();
    return await handle.getFile();
  } catch {
    try {
      encoder.close();
    } catch {
      // Already closed by the error that brought us here.
    }
    await writable.close().catch(() => undefined);
    await dir.removeEntry(`${options.checksum}.mp4`).catch(() => undefined);
    return null;
  } finally {
    source.muted = wasMuted;
  }
}
