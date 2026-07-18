//! Golden-file decode tests against real PNG/JPEG fixtures.

use media_core::{decode_image, probe_dimensions, probe_image, DecodeError, PixelFormat};

const RED_PNG: &[u8] = include_bytes!("fixtures/red_4x2_rgb.png");
const RED_JPG: &[u8] = include_bytes!("fixtures/red_4x2_rgb.jpg");
const GREEN_RGBA_PNG: &[u8] = include_bytes!("fixtures/green_3x3_rgba.png");

#[test]
fn decodes_png_rgb_with_exact_pixels() {
    let image = decode_image(RED_PNG).expect("PNG decodes");
    assert_eq!(image.metadata.width, 4);
    assert_eq!(image.metadata.height, 2);
    assert_eq!(image.metadata.format, PixelFormat::Rgb8);
    assert_eq!(image.pixels.len(), 4 * 2 * 3);
    for pixel in image.pixels.chunks_exact(3) {
        assert_eq!(pixel, [255u8, 0, 0].as_slice(), "every pixel is pure red");
    }
}

#[test]
fn decodes_rgba_png_preserving_alpha() {
    let image = decode_image(GREEN_RGBA_PNG).expect("RGBA PNG decodes");
    assert_eq!(image.metadata.width, 3);
    assert_eq!(image.metadata.height, 3);
    assert_eq!(image.metadata.format, PixelFormat::Rgba8);
    assert_eq!(image.pixels.len(), 3 * 3 * 4);
    for pixel in image.pixels.chunks_exact(4) {
        assert_eq!(pixel, [0u8, 128, 0, 200].as_slice());
    }
}

#[test]
fn decodes_jpeg_dimensions_and_format() {
    let image = decode_image(RED_JPG).expect("JPEG decodes");
    assert_eq!(image.metadata.width, 4);
    assert_eq!(image.metadata.height, 2);
    assert_eq!(image.metadata.format, PixelFormat::Rgb8);
    // JPEG is lossy: pixels are near-red, not exactly red.
    assert!(image.pixels[0] > 200, "red channel dominant");
    assert!(image.pixels[1] < 80 && image.pixels[2] < 80);
}

#[test]
fn probe_reports_metadata_and_cheap_dimensions() {
    assert_eq!(probe_dimensions(RED_PNG).unwrap(), (4, 2));
    let metadata = probe_image(GREEN_RGBA_PNG).unwrap();
    assert_eq!(metadata.format, PixelFormat::Rgba8);
    assert_eq!((metadata.width, metadata.height), (3, 3));
}

#[test]
fn rejects_non_image_bytes_without_panicking() {
    let error = decode_image(b"this is definitely not an image").unwrap_err();
    assert!(matches!(
        error,
        DecodeError::Corrupt(_) | DecodeError::UnsupportedFormat
    ));
}

#[test]
fn rejects_truncated_png() {
    let truncated = &RED_PNG[..RED_PNG.len() / 2];
    assert!(decode_image(truncated).is_err());
}
