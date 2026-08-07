export {
  timeToFrameIndex,
  frameToStartTimeUs,
  framesInDuration,
} from "./frame-timing.js";

export {
  resolveAtTime,
  sequenceDurationUs,
  type ActiveClip,
} from "./timeline.js";

export {
  createPlaybackState,
  play,
  pause,
  seek,
  setRate,
  setLoopRegion,
  tick,
  type PlaybackState,
  type LoopRegion,
} from "./transport.js";

export { planPrefetch, type FrameRequest } from "./prefetch.js";

export {
  applyAnimationEasing,
  sampleAnimationTrack,
  sampleClipAnimations,
  type SampledClipAnimations,
} from "./animation.js";

export { sampleClipTransition, type TransitionSample } from "./transition.js";

export {
  resolveAudioFades,
  audioEnvelopeGain,
  audioEnvelopeCurve,
  type ResolvedAudioFades,
} from "./audio-envelope.js";
