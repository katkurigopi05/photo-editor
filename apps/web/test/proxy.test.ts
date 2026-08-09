import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROXY_HEIGHT,
  PROXY_MIN_BYTES,
  PROXY_MIN_HEIGHT,
  SEEK_TIMEOUT_MS,
  proxyBitrateKbps,
  proxySize,
  seekTo,
  shouldBuildProxy,
} from "../src/proxy.js";

/**
 * Proxy media decisions.
 *
 * The transcode itself needs a browser; what is worth pinning here is every
 * rule that decides *whether* and *at what size* — the ones that would show up
 * as a rejected encoder configuration, a stretched preview, or a machine
 * grinding through proxies of footage that never needed one.
 */

describe("proxySize", () => {
  it("scales to the target height and keeps the aspect ratio", () => {
    expect(proxySize(3840, 2160)).toEqual({ width: 960, height: 540 });
    expect(proxySize(1920, 1080)).toEqual({ width: 960, height: 540 });
  });

  it("keeps a portrait source portrait", () => {
    expect(proxySize(1080, 1920)).toEqual({ width: 304, height: 540 });
  });

  it("never returns an odd dimension", () => {
    // H.264 encodes in 2x2 chroma blocks; an odd side is refused outright by
    // some encoders, which would mean no proxy at all for that clip.
    for (const [width, height] of [
      [1919, 1081],
      [1235, 723],
      [999, 777],
    ]) {
      const size = proxySize(width!, height!);
      expect(size.width % 2).toBe(0);
      expect(size.height % 2).toBe(0);
    }
  });

  it("does not upscale a source smaller than the target", () => {
    expect(proxySize(640, 360)).toEqual({ width: 640, height: 360 });
  });

  it("honours a different target height", () => {
    expect(proxySize(1920, 1080, 360)).toEqual({ width: 640, height: 360 });
  });

  it("stays at least two pixels on a degenerate source", () => {
    expect(proxySize(1, 1)).toEqual({ width: 2, height: 2 });
  });
});

describe("shouldBuildProxy", () => {
  it("proxies video at or above the height threshold", () => {
    expect(
      shouldBuildProxy({ kind: "video", width: 1280, height: PROXY_MIN_HEIGHT }),
    ).toBe(true);
    expect(shouldBuildProxy({ kind: "video", width: 3840, height: 2160 })).toBe(
      true,
    );
  });

  it("leaves small video alone", () => {
    expect(shouldBuildProxy({ kind: "video", width: 640, height: 360 })).toBe(
      false,
    );
  });

  it("proxies a large file whatever its dimensions", () => {
    // A long clip is slow to seek through even at modest resolution, and file
    // size is the only signal available before decoding it.
    expect(
      shouldBuildProxy({
        kind: "video",
        width: 640,
        height: 360,
        fileSizeBytes: PROXY_MIN_BYTES,
      }),
    ).toBe(true);
  });

  it("never proxies stills or audio", () => {
    for (const kind of ["image", "audio", "generated"]) {
      expect(
        shouldBuildProxy({
          kind,
          width: 6000,
          height: 4000,
          fileSizeBytes: PROXY_MIN_BYTES * 4,
        }),
      ).toBe(false);
    }
  });

  it("does not fall over on an asset with no dimensions recorded", () => {
    expect(shouldBuildProxy({ kind: "video" })).toBe(false);
  });
});

/**
 * A source with no `requestVideoFrameCallback`, so a landed seek is the whole
 * signal — which is the case `seekTo` has to get right without one.
 */
function fakeVideo(): HTMLVideoElement {
  return new EventTarget() as unknown as HTMLVideoElement;
}

describe("seekTo", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a decoded frame once the seek lands", async () => {
    const video = fakeVideo();
    const seek = seekTo(video, 4);
    expect(video.currentTime).toBe(4);
    video.dispatchEvent(new Event("seeked"));
    await expect(seek).resolves.toBe(true);
  });

  it("gives up when the source stops answering", async () => {
    // A seek has no failure event: a decode that dies part-way simply never
    // fires `seeked`. Without the cap the build awaits it forever and, because
    // builds are queued one at a time, every proxy behind it never runs.
    vi.useFakeTimers();
    const video = fakeVideo();
    const seek = seekTo(video, 4);
    await vi.advanceTimersByTimeAsync(SEEK_TIMEOUT_MS);
    await expect(seek).resolves.toBe(false);
  });

  it("gives up when the element errors", async () => {
    const video = fakeVideo();
    const seek = seekTo(video, 4);
    video.dispatchEvent(new Event("error"));
    await expect(seek).resolves.toBe(false);
  });

  it("leaves no timer behind once the seek lands", async () => {
    vi.useFakeTimers();
    const video = fakeVideo();
    const seek = seekTo(video, 4);
    video.dispatchEvent(new Event("seeked"));
    await expect(seek).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("proxyBitrateKbps", () => {
  it("scales with the picture", () => {
    expect(proxyBitrateKbps(960, PROXY_HEIGHT)).toBeGreaterThan(
      proxyBitrateKbps(640, 360),
    );
  });

  it("stays well under a source-grade bitrate", () => {
    // A proxy that is not much smaller than its source has bought nothing.
    expect(proxyBitrateKbps(960, 540)).toBeLessThan(3000);
  });

  it("keeps a floor for tiny pictures", () => {
    expect(proxyBitrateKbps(64, 64)).toBe(500);
  });
});
