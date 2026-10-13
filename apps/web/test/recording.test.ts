import { describe, expect, it, vi } from "vitest";
import {
  RecordingStudio,
  calculatePipRect,
  formatRecordingTime,
  pickRecordingMimeType,
  type MediaDevicesLike,
  type MediaRecorderLike,
  type RecordingDependencies,
} from "../src/recording.js";

function createMockTrack(kind: "video" | "audio") {
  let stopped = false;
  return {
    kind,
    stop: () => {
      stopped = true;
    },
    isStopped: () => stopped,
    getSettings: () => ({ width: 1920, height: 1080 }),
  };
}

function createMockStream(hasVideo = true, hasAudio = true) {
  const tracks: Array<ReturnType<typeof createMockTrack>> = [];
  if (hasVideo) tracks.push(createMockTrack("video"));
  if (hasAudio) tracks.push(createMockTrack("audio"));

  return {
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getTracks: () => tracks,
    addTrack: (track: ReturnType<typeof createMockTrack>) => tracks.push(track),
  } as unknown as MediaStream;
}

class FakeMediaRecorder implements MediaRecorderLike {
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(public stream: MediaStream, public options?: { mimeType?: string }) {}

  start(_timeslice?: number): void {
    this.state = "recording";
  }

  pause(): void {
    this.state = "paused";
  }

  resume(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob(["fake-recording-bytes"], { type: "video/webm" }) });
    }
    if (this.onstop) {
      this.onstop();
    }
  }
}

function createMockDeps(overrides: RecordingDependencies = {}): RecordingDependencies {
  const currentTime = 1000;
  const base: RecordingDependencies = {
    mediaDevices: {
      getDisplayMedia: vi.fn(async () => createMockStream(true, true)),
      getUserMedia: vi.fn(async () => createMockStream(true, true)),
    } as unknown as MediaDevicesLike,
    MediaRecorderCtor: FakeMediaRecorder as unknown as NonNullable<RecordingDependencies["MediaRecorderCtor"]>,
    isTypeSupported: (mime) => mime.includes("webm"),
    now: () => currentTime,
    setInterval: ((cb: () => void) => {
      cb();
      return 1 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval,
    clearInterval: vi.fn(),
    setTimeout: ((cb: () => void) => {
      cb();
      return 1 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout,
    clearTimeout: vi.fn(),
  };
  return Object.assign(base, overrides);
}

describe("Recording Studio", () => {
  describe("calculatePipRect", () => {
    it("calculates bottom-left pip coordinates", () => {
      const rect = calculatePipRect(1920, 1080, 0.2, "bottom-left", 20);
      expect(rect.width).toBe(216);
      expect(rect.height).toBe(216);
      expect(rect.x).toBe(20);
      expect(rect.y).toBe(1080 - 216 - 20);
      expect(rect.radius).toBe(108);
    });

    it("calculates bottom-right pip coordinates", () => {
      const rect = calculatePipRect(1920, 1080, 0.2, "bottom-right", 30);
      expect(rect.x).toBe(1920 - 216 - 30);
      expect(rect.y).toBe(1080 - 216 - 30);
    });

    it("calculates top-right pip coordinates", () => {
      const rect = calculatePipRect(1920, 1080, 0.2, "top-right", 15);
      expect(rect.x).toBe(1920 - 216 - 15);
      expect(rect.y).toBe(15);
    });

    it("calculates top-left pip coordinates", () => {
      const rect = calculatePipRect(1920, 1080, 0.2, "top-left", 10);
      expect(rect.x).toBe(10);
      expect(rect.y).toBe(10);
    });
  });

  describe("formatRecordingTime", () => {
    it("formats sub-minute times", () => {
      expect(formatRecordingTime(5_000_000)).toBe("00:05");
      expect(formatRecordingTime(45_000_000)).toBe("00:45");
    });

    it("formats minute-level times", () => {
      expect(formatRecordingTime(125_000_000)).toBe("02:05");
    });

    it("formats hour-level times", () => {
      expect(formatRecordingTime(3665_000_000)).toBe("01:01:05");
    });
  });

  describe("pickRecordingMimeType", () => {
    it("prefers requested mime if supported", () => {
      const mime = pickRecordingMimeType((m) => m === "video/mp4", "video/mp4");
      expect(mime).toBe("video/mp4");
    });

    it("falls back to supported webm variant", () => {
      const mime = pickRecordingMimeType((m) => m === "video/webm;codecs=vp9,opus");
      expect(mime).toBe("video/webm;codecs=vp9,opus");
    });

    it("defaults safely to video/webm when nothing matches", () => {
      const mime = pickRecordingMimeType(() => false);
      expect(mime).toBe("video/webm");
    });
  });

  describe("RecordingStudio lifecycle", () => {
    it("starts, records, and stops a session producing a file", async () => {
      let nowTime = 1000;
      const deps = createMockDeps({ now: () => nowTime });
      const studio = new RecordingStudio(deps);

      const states: string[] = [];
      studio.onStateChange((s) => states.push(s));

      await studio.start({ source: "screen", countdownSeconds: 0 });
      expect(studio.getState()).toBe("recording");

      nowTime += 5000; // 5 seconds later
      expect(studio.getElapsedTimeUs()).toBe(5_000_000);

      const output = await studio.stop("my-screen-recording.webm");
      expect(output.file.name).toBe("my-screen-recording.webm");
      expect(output.kind).toBe("video");
      expect(output.durationUs).toBe("5000000");
      expect(studio.getState()).toBe("idle");
      expect(states).toEqual(["recording", "idle"]);
    });

    it("handles pause and resume without accumulating paused duration", async () => {
      let nowTime = 1000;
      const deps = createMockDeps({ now: () => nowTime });
      const studio = new RecordingStudio(deps);

      await studio.start({ source: "camera", countdownSeconds: 0 });

      nowTime += 3000; // 3s recorded
      studio.pause();
      expect(studio.getState()).toBe("paused");
      expect(studio.getElapsedTimeUs()).toBe(3_000_000);

      nowTime += 10000; // paused for 10s
      expect(studio.getElapsedTimeUs()).toBe(3_000_000);

      studio.resume();
      expect(studio.getState()).toBe("recording");

      nowTime += 2000; // 2s more recorded
      expect(studio.getElapsedTimeUs()).toBe(5_000_000);

      const output = await studio.stop();
      expect(output.durationUs).toBe("5000000");
    });

    it("cancels recording and releases media tracks", async () => {
      const deps = createMockDeps();
      const studio = new RecordingStudio(deps);

      await studio.start({ source: "screen-with-camera", countdownSeconds: 0 });
      expect(studio.getState()).toBe("recording");

      studio.cancel();
      expect(studio.getState()).toBe("idle");
    });
  });
});
