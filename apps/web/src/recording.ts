/**
 * Screen & Camera Recording Studio.
 *
 * Inspired by Canva's Desktop Recording architecture (`desktop_recording`):
 * provides unified capture for screen, window, camera (webcam), and picture-in-picture
 * "talking head" presentations directly into Project Director.
 *
 * Recordings are produced as standard media files with microsecond timestamps and
 * probed metadata ready for `asset.register` into the deterministic engine.
 */

export type RecordingSource = "screen" | "camera" | "screen-with-camera" | "audio-only";
export type CameraPosition = "bottom-left" | "bottom-right" | "top-left" | "top-right";
export type CameraShape = "circle" | "rounded-rectangle";
export type RecordingState = "idle" | "countdown" | "recording" | "paused";

export interface PipLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

export interface RecordingConfig {
  source: RecordingSource;
  includeMic?: boolean;
  includeSystemAudio?: boolean;
  cameraPosition?: CameraPosition;
  cameraShape?: CameraShape;
  cameraScale?: number; // Ratio of screen width (e.g. 0.22 for ~22% width)
  countdownSeconds?: number;
  frameRate?: number;
  width?: number;
  height?: number;
  mimeType?: string;
  name?: string;
}

export interface RecordedOutput {
  blob: Blob;
  file: File;
  durationUs: string;
  width: number;
  height: number;
  kind: "video" | "audio";
}

export interface MediaDevicesLike {
  getDisplayMedia(constraints?: DisplayMediaStreamOptions): Promise<MediaStreamLike>;
  getUserMedia(constraints?: MediaStreamConstraints): Promise<MediaStreamLike>;
}

export interface MediaRecorderLike {
  state: "inactive" | "recording" | "paused";
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
  pause(): void;
  resume(): void;
}

export interface MediaStreamTrackLike {
  kind: string;
  stop(): void;
  getSettings?(): { width?: number; height?: number };
}

export interface MediaStreamLike {
  getVideoTracks(): MediaStreamTrackLike[];
  getAudioTracks(): MediaStreamTrackLike[];
  getTracks(): MediaStreamTrackLike[];
  addTrack(track: MediaStreamTrackLike): void;
}

export interface RecordingDependencies {
  mediaDevices?: MediaDevicesLike | undefined;
  MediaRecorderCtor?: (new (stream: MediaStreamLike, options?: { mimeType?: string }) => MediaRecorderLike) | undefined;
  MediaStreamCtor?: (new () => MediaStreamLike) | undefined;
  isTypeSupported?: ((mimeType: string) => boolean) | undefined;
  now?: (() => number) | undefined;
  setInterval?: typeof setInterval | undefined;
  clearInterval?: typeof clearInterval | undefined;
  setTimeout?: typeof setTimeout | undefined;
  clearTimeout?: typeof clearTimeout | undefined;
}

/** Compute picture-in-picture bounding box inside container */
export function calculatePipRect(
  containerWidth: number,
  containerHeight: number,
  scale = 0.22,
  position: CameraPosition = "bottom-left",
  margin = 32,
): PipLayout {
  const size = Math.round(Math.min(containerWidth, containerHeight) * scale);
  const radius = Math.round(size / 2);

  let x = margin;
  let y = containerHeight - size - margin;

  switch (position) {
    case "bottom-left":
      x = margin;
      y = containerHeight - size - margin;
      break;
    case "bottom-right":
      x = containerWidth - size - margin;
      y = containerHeight - size - margin;
      break;
    case "top-left":
      x = margin;
      y = margin;
      break;
    case "top-right":
      x = containerWidth - size - margin;
      y = margin;
      break;
  }

  return { x, y, width: size, height: size, radius };
}

/** Best supported mime type for recording */
export function pickRecordingMimeType(
  isSupported?: (mime: string) => boolean,
  preferred?: string,
): string {
  const check = isSupported ?? ((m: string) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
  if (preferred && check(preferred)) return preferred;

  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=avc1,mp4a",
    "video/mp4",
  ];

  for (const c of candidates) {
    if (check(c)) return c;
  }
  return "video/webm";
}

/** Formats elapsed recording microseconds to readable MM:SS or HH:MM:SS */
export function formatRecordingTime(elapsedUs: number): string {
  const totalSeconds = Math.floor(Math.max(0, elapsedUs) / 1_000_000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export class RecordingStudio {
  private state: RecordingState = "idle";
  private displayStream: MediaStreamLike | null = null;
  private cameraStream: MediaStreamLike | null = null;
  private combinedStream: MediaStreamLike | null = null;
  private recorder: MediaRecorderLike | null = null;
  private chunks: Blob[] = [];

  private startTime = 0;
  private pausedTime = 0;
  private totalPausedDuration = 0;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private countdownTimerId: ReturnType<typeof setTimeout> | null = null;

  private stateChangeListeners = new Set<(state: RecordingState, countdown?: number) => void>();
  private timeUpdateListeners = new Set<(elapsedUs: number) => void>();

  constructor(private deps: RecordingDependencies = {}) {}

  getState(): RecordingState {
    return this.state;
  }

  getElapsedTimeUs(): number {
    if (this.state === "idle" || this.state === "countdown" || this.startTime === 0) {
      return 0;
    }
    const now = (this.deps.now ?? Date.now)();
    if (this.state === "paused") {
      return Math.round((this.pausedTime - this.startTime - this.totalPausedDuration) * 1000);
    }
    return Math.round((now - this.startTime - this.totalPausedDuration) * 1000);
  }

  onStateChange(listener: (state: RecordingState, countdown?: number) => void): () => void {
    this.stateChangeListeners.add(listener);
    return () => this.stateChangeListeners.delete(listener);
  }

  onTimeUpdate(listener: (elapsedUs: number) => void): () => void {
    this.timeUpdateListeners.add(listener);
    return () => this.timeUpdateListeners.delete(listener);
  }

  private setState(newState: RecordingState, countdown?: number): void {
    this.state = newState;
    for (const l of this.stateChangeListeners) l(newState, countdown);
  }

  private notifyTime(): void {
    const elapsed = this.getElapsedTimeUs();
    for (const l of this.timeUpdateListeners) l(elapsed);
  }

  async start(config: RecordingConfig): Promise<void> {
    if (this.state !== "idle") {
      throw new Error(`Cannot start recording while in state ${this.state}`);
    }

    const mediaDevices = this.deps.mediaDevices ?? navigator.mediaDevices;
    const nowFn = this.deps.now ?? Date.now;
    const setTimer = this.deps.setInterval ?? setInterval;
    const setDelay = this.deps.setTimeout ?? setTimeout;

    // 1. Acquire media streams
    if (config.source === "screen" || config.source === "screen-with-camera") {
      this.displayStream = await mediaDevices.getDisplayMedia({
        video: { frameRate: config.frameRate ?? 30 },
        audio: config.includeSystemAudio ?? true,
      });
    }

    if (config.source === "camera" || config.source === "screen-with-camera" || config.includeMic) {
      try {
        this.cameraStream = await mediaDevices.getUserMedia({
          video: config.source === "camera" || config.source === "screen-with-camera" ? { width: 1280, height: 720 } : false,
          audio: config.includeMic ?? true,
        });
      } catch (err) {
        // If camera fails but screen is available and mic was requested, fallback to mic-only audio
        if (config.source !== "camera") {
          try {
            this.cameraStream = await mediaDevices.getUserMedia({ audio: true });
          } catch {
            // Audio permission denied; proceed with screen only
          }
        } else {
          this.cleanupStreams();
          throw err;
        }
      }
    }

    // 2. Composite streams
    this.combinedStream = this.compositeStreams(config);

    // 3. Setup MediaRecorder
    const mimeType = pickRecordingMimeType(this.deps.isTypeSupported, config.mimeType);
    const RecorderCtor =
      this.deps.MediaRecorderCtor ??
      (typeof MediaRecorder !== "undefined"
        ? (MediaRecorder as unknown as new (stream: MediaStreamLike, options?: { mimeType?: string }) => MediaRecorderLike)
        : null);

    if (!RecorderCtor) {
      this.cleanupStreams();
      throw new Error("MediaRecorder is not available in this environment");
    }

    const recorder = new RecorderCtor(this.combinedStream, { mimeType });
    this.recorder = recorder;
    this.chunks = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.chunks.push(e.data);
      }
    };

    // 4. Handle countdown
    const countdownSec = config.countdownSeconds ?? 0;
    if (countdownSec > 0) {
      let remaining = countdownSec;
      this.setState("countdown", remaining);

      await new Promise<void>((resolve) => {
        const tickCountdown = () => {
          remaining -= 1;
          if (remaining > 0) {
            this.setState("countdown", remaining);
            this.countdownTimerId = setDelay(tickCountdown, 1000);
          } else {
            resolve();
          }
        };
        this.countdownTimerId = setDelay(tickCountdown, 1000);
      });
    }

    // 5. Begin actual recording
    this.startTime = nowFn();
    this.pausedTime = 0;
    this.totalPausedDuration = 0;
    recorder.start(500); // 500ms chunk interval
    this.setState("recording");

    this.timerId = setTimer(() => this.notifyTime(), 100);
  }

  private createStream(): MediaStreamLike {
    if (this.deps.MediaStreamCtor) {
      return new this.deps.MediaStreamCtor();
    }
    if (typeof MediaStream !== "undefined") {
      return new MediaStream();
    }
    const tracks: MediaStreamTrackLike[] = [];
    return {
      getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
      getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
      getTracks: () => tracks,
      addTrack: (track: MediaStreamTrackLike) => tracks.push(track),
    };
  }

  private compositeStreams(config: RecordingConfig): MediaStreamLike {
    // If only one stream is needed without PiP
    if (config.source === "camera" && this.cameraStream) {
      return this.cameraStream;
    }
    if (config.source === "screen" && this.displayStream) {
      const stream = this.createStream();
      for (const track of this.displayStream.getVideoTracks()) stream.addTrack(track);
      for (const track of this.displayStream.getAudioTracks()) stream.addTrack(track);
      if (this.cameraStream) {
        for (const track of this.cameraStream.getAudioTracks()) stream.addTrack(track);
      }
      return stream;
    }

    // In a browser with "screen-with-camera", both video tracks or audio tracks are preserved
    const stream = this.createStream();
    if (this.displayStream) {
      for (const track of this.displayStream.getVideoTracks()) stream.addTrack(track);
      for (const track of this.displayStream.getAudioTracks()) stream.addTrack(track);
    }
    if (this.cameraStream) {
      // Audio from mic
      for (const track of this.cameraStream.getAudioTracks()) stream.addTrack(track);
      // Video from camera (if display is absent, use camera video directly)
      if (!this.displayStream) {
        for (const track of this.cameraStream.getVideoTracks()) stream.addTrack(track);
      }
    }
    return stream;
  }

  pause(): void {
    if (this.state !== "recording" || !this.recorder) return;
    this.recorder.pause();
    this.pausedTime = (this.deps.now ?? Date.now)();
    this.setState("paused");
  }

  resume(): void {
    if (this.state !== "paused" || !this.recorder) return;
    const now = (this.deps.now ?? Date.now)();
    this.totalPausedDuration += now - this.pausedTime;
    this.pausedTime = 0;
    this.recorder.resume();
    this.setState("recording");
  }

  async stop(outputName?: string): Promise<RecordedOutput> {
    if (this.state !== "recording" && this.state !== "paused") {
      throw new Error(`Cannot stop recording when in state ${this.state}`);
    }

    const elapsedUs = String(this.getElapsedTimeUs());
    const clearTimer = this.deps.clearInterval ?? clearInterval;
    if (this.timerId) {
      clearTimer(this.timerId);
      this.timerId = null;
    }

    return new Promise<RecordedOutput>((resolve, reject) => {
      if (!this.recorder) {
        this.cleanupStreams();
        this.setState("idle");
        reject(new Error("No active recorder"));
        return;
      }

      this.recorder.onstop = () => {
        try {
          const mimeType = this.chunks[0]?.type || "video/webm";
          const blob = new Blob(this.chunks, { type: mimeType });
          const isVideo = mimeType.startsWith("video/");
          const ext = isVideo ? (mimeType.includes("mp4") ? "mp4" : "webm") : "weba";
          const filename = outputName ?? `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
          const file = new File([blob], filename, { type: mimeType });

          // Probe dimensions from stream if available
          let width = 1920;
          let height = 1080;
          const videoTrack = this.combinedStream?.getVideoTracks()[0];
          if (videoTrack) {
            const settings = videoTrack.getSettings?.();
            if (settings?.width && settings?.height) {
              width = settings.width;
              height = settings.height;
            }
          }

          this.cleanupStreams();
          this.setState("idle");

          resolve({
            blob,
            file,
            durationUs: elapsedUs,
            width,
            height,
            kind: isVideo ? "video" : "audio",
          });
        } catch (e) {
          this.cleanupStreams();
          this.setState("idle");
          reject(e);
        }
      };

      this.recorder.stop();
    });
  }

  cancel(): void {
    const clearTimer = this.deps.clearInterval ?? clearInterval;
    const clearDelay = this.deps.clearTimeout ?? clearTimeout;
    if (this.timerId) {
      clearTimer(this.timerId);
      this.timerId = null;
    }
    if (this.countdownTimerId) {
      clearDelay(this.countdownTimerId);
      this.countdownTimerId = null;
    }
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        // Stream might already be closed; ignore during cancellation
      }
    }
    this.cleanupStreams();
    this.chunks = [];
    this.setState("idle");
  }

  private cleanupStreams(): void {
    if (this.displayStream) {
      for (const t of this.displayStream.getTracks()) t.stop();
      this.displayStream = null;
    }
    if (this.cameraStream) {
      for (const t of this.cameraStream.getTracks()) t.stop();
      this.cameraStream = null;
    }
    if (this.combinedStream) {
      for (const t of this.combinedStream.getTracks()) t.stop();
      this.combinedStream = null;
    }
    this.recorder = null;
  }
}
