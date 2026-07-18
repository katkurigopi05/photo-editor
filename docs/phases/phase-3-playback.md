# Phase 3 — Playback & Scrubbing (transport + timing layer, built)

Phase 3 coordinates timeline time navigation, look-ahead prefetching, and playhead ticking at interactive speeds. This document tracks what is **actually built** in `packages/playback-controller`.

## Design Philosophy

* **Separation of Concerns:** Playback state (playing, current time, loop region, playback rate) is session-specific UI state. It is kept completely out of the core `Project` state and the command engine to ensure undo/redo and replay remain simple, deterministic, and unaffected by playback transport.
* **Exact Rational Math:** All frame-to-time and time-to-frame conversions use bigint microseconds and exact `Rational` arithmetic. This eliminates floating-point drift and guarantees perfect round-trips for fractional frame rates (such as 30000/1001 for 29.97 fps) even over hours of simulated playback.

## timing & Frame Math (`frame-timing.ts`)

Pure functions for converting between microseconds and frame indices:

```ts
timeToFrameIndex(timelineUs: string, rate: Rational) -> number
frameToStartTimeUs(frameIndex: number, rate: Rational) -> string
framesInDuration(durationUs: string, rate: Rational) -> number
```

- Converts exactly using integer division and ceiling division (`ceil(n * den * 1e6 / num)`).
- Guaranteed that `timeToFrameIndex(frameToStartTimeUs(n)) === n`.
- Rejects negative times, negative frame indices, and non-positive frame rates.

## Transport state & Reducers (`transport.ts`)

Pure state transitions for transport control:

* **State Model:**
  ```ts
  interface PlaybackState {
    currentTimeUs: string;
    playing: boolean;
    rate: Rational;
    loopRegion: LoopRegion | null;
    durationUs: string;
  }
  ```
* **Operations:**
  - `play(state)` / `pause(state)`: Toggles playback state.
  - `seek(state, timeUs)`: Clamps the playhead within `[0, durationUs]`.
  - `setRate(state, rate)`: Changes the playback speed multiplier.
  - `setLoopRegion(state, region)`: Restricts playback to a sub-region (start must be strictly less than end, non-negative, and within duration).
  - `tick(state, deltaUs)`: Advances current time by the given delta (scaled by `rate`).
    - Paused: No-op.
    - Loop Region Set: Wraps timeline time back to the start of the loop region when crossing the loop region end (using modulo arithmetic over the loop duration).
    - No Loop Region: Clamps and automatically pauses (playing -> false) at `durationUs`.

## Active Clip & Timeline Resolution (`timeline.ts`)

Pure functions to query the timeline sequence:

* **`resolveAtTime(sequence, timelineUs)`**: Resolves which clips are active on each track at the given microsecond.
  - Returns `ActiveClip[]` (ordered by track).
  - Evaluated using half-open interval containment `[start, start + duration)`. Gaps are omitted.
  - Computes `sourceTimeUs = sourceInUs + offsetUs * playbackRate` (playbackRate is applied exactly).
* **`sequenceDurationUs(sequence)`**: Finds the end of the last clip across all tracks to determine the playable duration.

## Look-Ahead Prefetching (`prefetch.ts`)

Pure planning function for frame prefetch scheduling:

* **`planPrefetch(sequence, currentTimeUs, lookAheadUs)`**: Plans which frames need to be decoded/prefetched.
  - Scans frame starts within the look-ahead window.
  - Resolves active clips for each frame time.
  - Returns an array of `FrameRequest`s ordered by ascending frame index, then by track order.

## Not built (rest of Phase 3)

The stateful, asynchronous scheduler/runner that interfaces with the decoded cache (Phase 1) and calls the WebGPU/native renderer (Phase 2) is deferred. The playback controller package provides the pure math and state machine that will drive it.

## Required Tests (`packages/playback-controller/test/playback.test.ts`)

Verified gates include:
- Exact round-trips of frame index and timestamps for integer and non-integer frame rates.
- Clamping and auto-pausing on seeking and ticking past bounds.
- Wrapping modulo arithmetic for active loop regions.
- Frame prefetch ordering and active-clip mapping.
- **Drift-free assertions:** Over a simulated 30,000-frame (10-hour) ticking sequence at 29.97 fps, accumulation drift is exactly `0` microseconds.
