//! `audio-engine` — deterministic audio DSP primitives (Phase 4 core).
//!
//! Pure functions over sample buffers: gain, constant-power pan, sample-accurate
//! mixing of overlapping clips, linear resampling, and waveform (peak/RMS)
//! bucketing. No decoding, playback, clock, randomness, or I/O — mixing is a
//! pure function of its inputs, matching the Foundation determinism contract.
//!
//! Samples are `f32` in the nominal range `[-1.0, 1.0]`; mono unless stated.

#![forbid(unsafe_code)]

use std::f32::consts::FRAC_PI_4;

/// Convert a gain in decibels to a linear amplitude multiplier. `0 dB` is unity.
#[must_use]
pub fn db_to_gain(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

/// Per-channel gains for a stereo pan.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StereoGain {
    pub left: f32,
    pub right: f32,
}

/// Constant-power pan. `pan` is clamped to `[-1.0, 1.0]`: `-1` is hard left,
/// `0` is center (each channel at `1/sqrt(2)`, i.e. −3 dB), `+1` is hard right.
#[must_use]
pub fn pan_gains(pan: f32) -> StereoGain {
    let p = pan.clamp(-1.0, 1.0);
    // Map [-1, 1] to an angle in [0, PI/2].
    let angle = (p + 1.0) * FRAC_PI_4;
    StereoGain {
        left: angle.cos(),
        right: angle.sin(),
    }
}

/// A mono clip placed on the mix timeline (in samples), with gain and pan.
#[derive(Debug, Clone, Copy)]
pub struct ClipSource<'a> {
    pub samples: &'a [f32],
    /// Start offset in the output, in frames.
    pub start_frame: usize,
    pub gain_db: f32,
    pub pan: f32,
}

/// Sample-accurate mix of overlapping mono sources into an interleaved stereo
/// buffer of `frames` frames (length `frames * 2`). Overlapping clips sum.
/// Deterministic for a fixed source order.
#[must_use]
pub fn mix_stereo(sources: &[ClipSource], frames: usize) -> Vec<f32> {
    let mut out = vec![0.0_f32; frames * 2];
    for source in sources {
        let gain = db_to_gain(source.gain_db);
        let pan = pan_gains(source.pan);
        let left_gain = gain * pan.left;
        let right_gain = gain * pan.right;
        for (i, &sample) in source.samples.iter().enumerate() {
            let frame = source.start_frame + i;
            if frame >= frames {
                break;
            }
            out[frame * 2] += sample * left_gain;
            out[frame * 2 + 1] += sample * right_gain;
        }
    }
    out
}

/// Linearly resample a mono buffer from `src_rate` to `dst_rate`. Returns the
/// input unchanged when the rates match. Deterministic.
#[must_use]
pub fn resample_linear(input: &[f32], src_rate: u32, dst_rate: u32) -> Vec<f32> {
    if input.is_empty() || src_rate == dst_rate {
        return input.to_vec();
    }
    let ratio = f64::from(dst_rate) / f64::from(src_rate);
    let out_len = ((input.len() as f64) * ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_pos = i as f64 / ratio;
        let idx = src_pos.floor() as usize;
        let frac = (src_pos - idx as f64) as f32;
        let a = input.get(idx).copied().unwrap_or(0.0);
        let b = input.get(idx + 1).copied().unwrap_or(a);
        out.push(a + (b - a) * frac);
    }
    out
}

/// One waveform display bucket.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WaveformBucket {
    pub peak: f32,
    pub rms: f32,
}

/// Compute peak and RMS per fixed-size bucket for waveform display. Returns an
/// empty vector when `bucket_size` is zero.
#[must_use]
pub fn waveform(input: &[f32], bucket_size: usize) -> Vec<WaveformBucket> {
    if bucket_size == 0 {
        return Vec::new();
    }
    input
        .chunks(bucket_size)
        .map(|chunk| {
            let peak = chunk.iter().fold(0.0_f32, |m, &x| m.max(x.abs()));
            let sum_sq: f32 = chunk.iter().map(|&x| x * x).sum();
            let rms = (sum_sq / chunk.len() as f32).sqrt();
            WaveformBucket { peak, rms }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-4
    }

    #[test]
    fn db_to_gain_known_values() {
        assert!(close(db_to_gain(0.0), 1.0));
        assert!(close(db_to_gain(-6.0206), 0.5));
        assert!(close(db_to_gain(20.0), 10.0));
    }

    #[test]
    fn pan_is_constant_power() {
        let center = pan_gains(0.0);
        assert!(close(center.left, std::f32::consts::FRAC_1_SQRT_2));
        assert!(close(center.right, std::f32::consts::FRAC_1_SQRT_2));

        let left = pan_gains(-1.0);
        assert!(close(left.left, 1.0) && close(left.right, 0.0));

        let right = pan_gains(1.0);
        assert!(close(right.left, 0.0) && close(right.right, 1.0));
    }

    #[test]
    fn mix_sums_overlapping_clips_deterministically() {
        let a = [1.0_f32, 1.0, 1.0];
        let b = [0.5_f32, 0.5];
        let sources = [
            ClipSource {
                samples: &a,
                start_frame: 0,
                gain_db: 0.0,
                pan: 0.0,
            },
            ClipSource {
                samples: &b,
                start_frame: 1,
                gain_db: 0.0,
                pan: 0.0,
            },
        ];
        let mix1 = mix_stereo(&sources, 3);
        let mix2 = mix_stereo(&sources, 3);
        assert_eq!(mix1, mix2, "mix is reproducible");

        // Center pan scales each channel by 1/sqrt(2). Frame 1 sums a+b.
        let g = std::f32::consts::FRAC_1_SQRT_2;
        assert!(close(mix1[0], 1.0 * g)); // frame 0 left (only a)
        assert!(close(mix1[2], (1.0 + 0.5) * g)); // frame 1 left (a + b)
    }

    #[test]
    fn mix_respects_clip_start_boundary() {
        let a = [1.0_f32];
        let sources = [ClipSource {
            samples: &a,
            start_frame: 2,
            gain_db: 0.0,
            pan: -1.0, // hard left
        }];
        let mix = mix_stereo(&sources, 3);
        // Only frame 2 left channel is nonzero.
        assert!(close(mix[0], 0.0) && close(mix[2], 0.0));
        assert!(close(mix[4], 1.0) && close(mix[5], 0.0));
    }

    #[test]
    fn resample_identity_and_length() {
        let input = [0.0_f32, 1.0, 0.0, -1.0];
        assert_eq!(resample_linear(&input, 48_000, 48_000), input);
        let up = resample_linear(&input, 24_000, 48_000);
        assert_eq!(up.len(), 8);
    }

    #[test]
    fn waveform_peak_and_rms() {
        let input = [0.5_f32, -0.5, 0.5, -0.5];
        let buckets = waveform(&input, 2);
        assert_eq!(buckets.len(), 2);
        assert!(close(buckets[0].peak, 0.5));
        assert!(close(buckets[0].rms, 0.5));
        assert!(waveform(&input, 0).is_empty());
    }
}
