//! `media-core`.
//!
//! Declares the platform-independent pixel and color types, and provides real
//! read-only image decoding (PNG/JPEG) via the `image` crate — the first slice
//! of the media-decoding phase. Video, audio, and RAW decoding remain future
//! phases. Decoding never writes to any source and never panics on bad input.

#![forbid(unsafe_code)]

mod decode;
pub use decode::{
    decode_image, probe_dimensions, probe_image, DecodeError, DecodedImage, ImageMetadata,
};

/// A pixel layout. Decoding (Phase 1) will map container/codec output into one
/// of these; this phase only enumerates them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PixelFormat {
    /// 8 bits per channel, red-green-blue-alpha.
    Rgba8,
    /// 8 bits per channel, red-green-blue.
    Rgb8,
    /// Planar 4:2:0 YUV, 8 bits per sample.
    Yuv420p,
}

impl PixelFormat {
    /// Number of bytes required to store a single pixel, when the format is
    /// packed (planar formats report their average, rounded up).
    #[must_use]
    pub const fn bytes_per_pixel(self) -> u8 {
        match self {
            PixelFormat::Rgba8 => 4,
            PixelFormat::Rgb8 => 3,
            // 4:2:0 averages 12 bits per pixel; round up to whole bytes.
            PixelFormat::Yuv420p => 2,
        }
    }
}

/// A working or output color space. Conversion is defined by later phases; this
/// enum only names the spaces the engine understands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ColorSpace {
    /// Standard sRGB.
    Srgb,
    /// Rec. 709 (HD video).
    Rec709,
    /// Rec. 2020 (wide-gamut / HDR).
    Rec2020,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_per_pixel_is_stable() {
        assert_eq!(PixelFormat::Rgba8.bytes_per_pixel(), 4);
        assert_eq!(PixelFormat::Rgb8.bytes_per_pixel(), 3);
        assert_eq!(PixelFormat::Yuv420p.bytes_per_pixel(), 2);
    }

    #[test]
    fn color_spaces_are_distinct() {
        assert_ne!(ColorSpace::Srgb, ColorSpace::Rec709);
        assert_ne!(ColorSpace::Rec709, ColorSpace::Rec2020);
    }
}
