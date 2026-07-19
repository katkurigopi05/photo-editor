//! `export-engine` — deterministic export timestamp/mux planning (Phase 6 core).
//!
//! Codec/container declarations plus pure presentation-timestamp math derived
//! from the canonical microsecond model. Contains **no** actual encoding or
//! muxing (that needs codec libraries); it computes the deterministic timestamp
//! table a real muxer would use. No clock, randomness, or I/O.

#![forbid(unsafe_code)]

const US_PER_SECOND: u64 = 1_000_000;

/// Output container formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Container {
    Mp4,
    Mov,
    Webm,
    PngSequence,
}

/// Video codecs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoCodec {
    H264,
    H265,
    Vp9,
    Av1,
    ProRes,
    PngSequence,
}

impl Container {
    /// Whether a video codec is valid inside this container.
    #[must_use]
    pub fn accepts(self, codec: VideoCodec) -> bool {
        match self {
            Container::Mp4 => {
                matches!(codec, VideoCodec::H264 | VideoCodec::H265 | VideoCodec::Av1)
            }
            Container::Mov => matches!(
                codec,
                VideoCodec::H264 | VideoCodec::H265 | VideoCodec::ProRes
            ),
            Container::Webm => matches!(codec, VideoCodec::Vp9 | VideoCodec::Av1),
            Container::PngSequence => matches!(codec, VideoCodec::PngSequence),
        }
    }
}

/// The presentation timestamp (in microseconds) of frame `frame_index` at a
/// frame rate of `numerator / denominator` fps. `floor(f * den * 1e6 / num)`.
///
/// # Panics
/// Panics if `numerator` is zero.
#[must_use]
pub fn frame_pts_us(frame_index: u64, numerator: u64, denominator: u64) -> u64 {
    assert!(numerator != 0, "frame rate numerator must be nonzero");
    frame_index * denominator * US_PER_SECOND / numerator
}

/// The monotonically increasing presentation timestamps for `frame_count`
/// frames, as a real muxer would lay them out.
#[must_use]
pub fn timestamp_table(frame_count: u64, numerator: u64, denominator: u64) -> Vec<u64> {
    (0..frame_count)
        .map(|f| frame_pts_us(f, numerator, denominator))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn container_codec_compatibility() {
        assert!(Container::Webm.accepts(VideoCodec::Vp9));
        assert!(Container::Webm.accepts(VideoCodec::Av1));
        assert!(!Container::Webm.accepts(VideoCodec::H264));
        assert!(Container::Mp4.accepts(VideoCodec::H264));
        assert!(!Container::Mp4.accepts(VideoCodec::ProRes));
        assert!(Container::Mov.accepts(VideoCodec::ProRes));
        assert!(Container::PngSequence.accepts(VideoCodec::PngSequence));
    }

    #[test]
    fn pts_starts_at_zero_and_is_known() {
        assert_eq!(frame_pts_us(0, 30, 1), 0);
        assert_eq!(frame_pts_us(1, 30, 1), 33_333);
        assert_eq!(frame_pts_us(30, 30, 1), 1_000_000);
        // 29.97 fps
        assert_eq!(frame_pts_us(1, 30_000, 1001), 33_366);
    }

    #[test]
    fn timestamp_table_is_strictly_increasing() {
        let table = timestamp_table(100, 30_000, 1001);
        assert_eq!(table.len(), 100);
        assert_eq!(table[0], 0);
        for pair in table.windows(2) {
            assert!(pair[1] > pair[0], "timestamps must strictly increase");
        }
    }

    #[test]
    #[should_panic(expected = "numerator must be nonzero")]
    fn zero_numerator_panics() {
        let _ = frame_pts_us(1, 0, 1);
    }
}
