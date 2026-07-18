//! Real image decoding (Phase 1 slice).
//!
//! Decodes actual PNG/JPEG bytes into normalized 8-bit pixels and probes their
//! dimensions, using the `image` crate. Decoding is strictly read-only: it never
//! writes to any source. All failures are typed; corrupt or unsupported input
//! returns an error rather than panicking.

use std::io::Cursor;

use image::{ColorType, DynamicImage, ImageError, ImageReader};

use crate::PixelFormat;

/// A typed decode failure. No decode path panics on bad input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodeError {
    /// The container/codec is not supported by this build.
    UnsupportedFormat,
    /// The bytes could not be decoded (truncated, malformed, wrong type).
    Corrupt(String),
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DecodeError::UnsupportedFormat => write!(f, "unsupported image format"),
            DecodeError::Corrupt(message) => write!(f, "corrupt image: {message}"),
        }
    }
}

impl std::error::Error for DecodeError {}

/// Probed image metadata, ready to populate a `MediaAsset` at import time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageMetadata {
    pub width: u32,
    pub height: u32,
    pub format: PixelFormat,
}

/// A fully decoded image with normalized 8-bit pixels. RGBA-capable inputs are
/// normalized to `Rgba8`; everything else to `Rgb8`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedImage {
    pub metadata: ImageMetadata,
    pub pixels: Vec<u8>,
}

fn map_error(error: ImageError) -> DecodeError {
    match error {
        ImageError::Unsupported(_) => DecodeError::UnsupportedFormat,
        other => DecodeError::Corrupt(other.to_string()),
    }
}

fn normalize(image: DynamicImage) -> (PixelFormat, Vec<u8>) {
    match image.color() {
        ColorType::Rgba8
        | ColorType::Rgba16
        | ColorType::Rgba32F
        | ColorType::La8
        | ColorType::La16 => (PixelFormat::Rgba8, image.to_rgba8().into_raw()),
        _ => (PixelFormat::Rgb8, image.to_rgb8().into_raw()),
    }
}

/// Decode PNG/JPEG bytes into normalized 8-bit pixels.
///
/// # Errors
/// Returns [`DecodeError`] for unsupported or corrupt input; never panics.
pub fn decode_image(bytes: &[u8]) -> Result<DecodedImage, DecodeError> {
    let image = image::load_from_memory(bytes).map_err(map_error)?;
    let width = image.width();
    let height = image.height();
    let (format, pixels) = normalize(image);
    Ok(DecodedImage {
        metadata: ImageMetadata {
            width,
            height,
            format,
        },
        pixels,
    })
}

/// Probe full metadata (decodes to determine the normalized pixel format).
///
/// # Errors
/// Returns [`DecodeError`] for unsupported or corrupt input.
pub fn probe_image(bytes: &[u8]) -> Result<ImageMetadata, DecodeError> {
    Ok(decode_image(bytes)?.metadata)
}

/// Cheaply read just the pixel dimensions without decoding the full image.
///
/// # Errors
/// Returns [`DecodeError`] for unsupported or corrupt input.
pub fn probe_dimensions(bytes: &[u8]) -> Result<(u32, u32), DecodeError> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| DecodeError::Corrupt(error.to_string()))?;
    reader.into_dimensions().map_err(map_error)
}
