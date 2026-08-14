//! WebP encoding for the hub's picture corpus (issue #1623).
//!
//! This is the only place coilbox turns pixels into WebP. It lives in the
//! unitsync worker because that is where the archive bytes already are, and
//! because the worker is a sidecar: `libwebp-sys` compiles C, and confining it
//! here keeps the C toolchain out of the app binary.
//!
//! Every number comes from [`coilbox_assets`], which reads
//! `shared/asset-vocabulary.json`. Nothing here spells 80 or 512 a second time,
//! because a constant duplicated between the encoder and the vocabulary is
//! exactly the drift issue #1622 existed to stop: the hub checks the encoded
//! bytes against its own copy of those numbers and rejects what does not match,
//! so a divergence shows up as a failed upload on a user's machine rather than
//! as a compile error here.
//!
//! Alpha survives. Lossy WebP compresses the alpha plane losslessly by default
//! (`alpha_compression` on, `alpha_quality` 100), so a build pic's cutout is
//! still a cutout after a q80 pass, and nothing is ever composited onto a
//! background colour.
//!
//! Nothing carries metadata out. The encoder is handed a decoded pixel buffer
//! rather than a file, so there is no EXIF, ICC profile or XMP block to inherit,
//! and libwebp writes none of its own. That also makes the output a pure
//! function of the pixels and the profile: the same image encoded twice is the
//! same bytes, with no timestamp in it.
//!
//! `overlay:height` is not encodable here and returns [`EncodeError::NotWebp`].
//! It is 16 bit grayscale PNG, because WebP's lossless mode is 8 bit ARGB and
//! would throw away half the height precision. Issue #1627 owns it.

// Nothing calls this yet. The build pic, metal map and minimap extraction paths
// are issues #1624, #1626 and #1630, which land after it, and until one of them
// does every item here is dead to the binary. The tests exercise all of it.
#![allow(dead_code)]

use coilbox_assets::{class_for_variant, vocabulary, AssetClass};
use image::DynamicImage;

/// Encoded bytes and the profile that produced them.
///
/// The profile travels with the bytes because a later re-encode pass has to be
/// able to tell last year's output from this year's without decoding anything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncodedAsset {
    pub bytes: Vec<u8>,
    /// The vocabulary's `encodeProfile` for this variant's class, e.g.
    /// `webp-q80-512`. Names the codec, the quality and the size cap, and
    /// changes only when one of those settings changes.
    pub encode_profile: String,
    /// The type to declare on upload, always `image/webp` from this function.
    pub mime: String,
    /// The encoded dimensions, which are the source's unless the class capped
    /// them.
    pub width: u32,
    pub height: u32,
}

/// Why a picture could not become the variant it was asked to be.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EncodeError {
    /// A variant the vocabulary does not list, so the hub would refuse it too.
    UnknownVariant(String),
    /// A variant that is real but is not WebP, which is `overlay:height` and
    /// only `overlay:height`.
    NotWebp { variant: String, mime: String },
    /// Zero pixels in one direction. libwebp reports this as
    /// `VP8_ENC_ERROR_BAD_DIMENSION`, which says nothing useful.
    EmptyImage,
    /// The class requires a square and the source is not one. Cropping or
    /// padding is the caller's decision, not the encoder's.
    NotSquare { width: u32, height: u32 },
    /// libwebp refused the picture.
    Libwebp(String),
    /// The encode succeeded and is still bigger than the class allows. The hub
    /// applies the same cap, so failing here is failing early.
    TooLarge { bytes: u64, cap: u64 },
}

impl std::fmt::Display for EncodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownVariant(v) => write!(f, "no asset class for variant {v}"),
            Self::NotWebp { variant, mime } => write!(f, "variant {variant} is {mime}, not WebP"),
            Self::EmptyImage => write!(f, "image has a zero-length edge"),
            Self::NotSquare { width, height } => {
                write!(f, "class requires a square, got {width}x{height}")
            }
            Self::Libwebp(msg) => write!(f, "libwebp: {msg}"),
            Self::TooLarge { bytes, cap } => {
                write!(f, "encoded to {bytes} bytes, over the {cap} byte cap")
            }
        }
    }
}

impl std::error::Error for EncodeError {}

/// Encode one picture as the variant names it, to the vocabulary's profile.
///
/// The variant is the hub's own string: `buildpic`, `render:top`, `minimap`,
/// `overlay:metal` or `overlay:type`. Whether that is lossless or q80, and what
/// the longest edge may be, comes from the vocabulary rather than from the
/// caller, so two extraction paths cannot encode the same class differently.
///
/// Oversized images are downscaled to the class's cap, preserving aspect ratio.
/// Undersized ones are left alone: upscaling invents detail and costs bytes.
pub fn encode_variant(variant: &str, image: &DynamicImage) -> Result<EncodedAsset, EncodeError> {
    let class = class_for_variant(variant)
        .ok_or_else(|| EncodeError::UnknownVariant(variant.to_string()))?;
    if class.mime != "image/webp" {
        return Err(EncodeError::NotWebp {
            variant: variant.to_string(),
            mime: class.mime.clone(),
        });
    }
    if image.width() == 0 || image.height() == 0 {
        return Err(EncodeError::EmptyImage);
    }
    if class.square && image.width() != image.height() {
        return Err(EncodeError::NotSquare {
            width: image.width(),
            height: image.height(),
        });
    }

    let scaled = fit_to_cap(image, class.max_edge_px);
    let bytes = encode_pixels(scaled.as_ref().unwrap_or(image), class)?;

    let cap = class.max_bytes.unwrap_or(vocabulary().max_object_bytes);
    if bytes.len() as u64 > cap {
        return Err(EncodeError::TooLarge {
            bytes: bytes.len() as u64,
            cap,
        });
    }

    let encoded = scaled.as_ref().unwrap_or(image);
    Ok(EncodedAsset {
        bytes,
        encode_profile: class.encode_profile.clone(),
        mime: class.mime.clone(),
        width: encoded.width(),
        height: encoded.height(),
    })
}

/// The downscaled image, or `None` when the source already fits and copying it
/// would be waste.
fn fit_to_cap(image: &DynamicImage, max_edge_px: Option<u32>) -> Option<DynamicImage> {
    let cap = max_edge_px?;
    if image.width() <= cap && image.height() <= cap {
        return None;
    }
    // `resize` fits inside the box and keeps the aspect ratio, so a square class
    // stays square. Lanczos3 is what the rest of the worker downscales with.
    Some(image.resize(cap, cap, image::imageops::FilterType::Lanczos3))
}

/// Hand libwebp the pixels in the layout that matches what the picture actually
/// carries.
///
/// An opaque source goes in as RGB rather than RGBA with a full-opacity plane,
/// so an image with no transparency does not pay for one.
fn encode_pixels(image: &DynamicImage, class: &AssetClass) -> Result<Vec<u8>, EncodeError> {
    let (w, h) = (image.width(), image.height());
    let quality = f32::from(class.quality.unwrap_or(0));

    let memory = if image.color().has_alpha() {
        let rgba = image.to_rgba8();
        webp::Encoder::from_rgba(rgba.as_raw(), w, h).encode_simple(class.lossless, quality)
    } else {
        let rgb = image.to_rgb8();
        webp::Encoder::from_rgb(rgb.as_raw(), w, h).encode_simple(class.lossless, quality)
    }
    .map_err(|e| EncodeError::Libwebp(format!("{e:?}")))?;

    Ok(memory.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage, Rgba, RgbaImage};

    /// A square with a fully transparent quadrant and three opaque coloured
    /// ones, so a round trip has something to lose.
    fn cutout(side: u32) -> DynamicImage {
        let mut img = RgbaImage::new(side, side);
        let half = side / 2;
        for (x, y, px) in img.enumerate_pixels_mut() {
            *px = match (x < half, y < half) {
                (true, true) => Rgba([0, 0, 0, 0]),
                (false, true) => Rgba([220, 30, 40, 255]),
                (true, false) => Rgba([30, 220, 40, 255]),
                (false, false) => Rgba([30, 40, 220, 255]),
            };
        }
        DynamicImage::ImageRgba8(img)
    }

    /// An opaque image with enough structure that a lossy pass has work to do.
    fn opaque(w: u32, h: u32) -> DynamicImage {
        let mut img = RgbImage::new(w, h);
        for (x, y, px) in img.enumerate_pixels_mut() {
            *px = Rgb([(x % 256) as u8, (y % 256) as u8, ((x + y) % 256) as u8]);
        }
        DynamicImage::ImageRgb8(img)
    }

    /// The RIFF chunk ids in a WebP file, in order. WebP is RIFF, so metadata
    /// would be visible as an `EXIF`, `ICCP` or `XMP ` chunk if anything ever
    /// wrote one.
    fn riff_chunks(bytes: &[u8]) -> Vec<String> {
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WEBP");
        let mut chunks = Vec::new();
        let mut at = 12usize;
        while at + 8 <= bytes.len() {
            let id = String::from_utf8_lossy(&bytes[at..at + 4]).to_string();
            let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as usize;
            chunks.push(id);
            // Chunk payloads are padded to an even length.
            at += 8 + size + (size % 2);
        }
        chunks
    }

    #[test]
    fn encodes_every_webp_variant_the_vocabulary_lists() {
        for variant in [
            "buildpic",
            "render:top",
            "minimap",
            "overlay:metal",
            "overlay:type",
        ] {
            let out = encode_variant(variant, &cutout(64)).unwrap();
            assert_eq!(out.mime, "image/webp", "{variant}");
            assert_eq!(&out.bytes[0..4], b"RIFF", "{variant}");
            assert_eq!(&out.bytes[8..12], b"WEBP", "{variant}");
        }
    }

    #[test]
    fn records_the_profile_that_produced_the_bytes() {
        let profile = |variant: &str| encode_variant(variant, &cutout(32)).unwrap().encode_profile;
        assert_eq!(profile("buildpic"), "webp-lossless-256");
        assert_eq!(profile("render:top"), "webp-q80-256");
        assert_eq!(profile("minimap"), "webp-q80-512");
        assert_eq!(profile("overlay:metal"), "webp-lossless-source");
        assert_eq!(profile("overlay:type"), "webp-lossless-source");
    }

    #[test]
    fn a_lossless_class_returns_every_sample_it_was_given() {
        let source = cutout(64);
        let out = encode_variant("buildpic", &source).unwrap();
        let decoded = webp::Decoder::new(&out.bytes).decode().unwrap();
        assert_eq!((decoded.width(), decoded.height()), (64, 64));
        assert!(decoded.is_alpha(), "lossless dropped the alpha channel");
        assert_eq!(&*decoded, source.to_rgba8().as_raw().as_slice());
    }

    #[test]
    fn a_lossy_class_keeps_alpha_exactly_and_never_flattens_it() {
        let source = cutout(64);
        let out = encode_variant("render:top", &source).unwrap();
        let decoded = webp::Decoder::new(&out.bytes).decode().unwrap();
        assert!(decoded.is_alpha(), "lossy dropped the alpha channel");

        // libwebp compresses the alpha plane losslessly even in a lossy encode,
        // so the transparent quadrant comes back exactly transparent rather than
        // nearly so, and no background colour has been composited in.
        let round_tripped = decoded.chunks_exact(4).collect::<Vec<_>>();
        let expected = source.to_rgba8();
        for (px, want) in round_tripped.iter().zip(expected.pixels()) {
            assert_eq!(px[3], want.0[3], "alpha changed under a lossy encode");
        }

        // And it really is lossy, otherwise the assertion above proves nothing.
        assert!(
            round_tripped
                .iter()
                .zip(expected.pixels())
                .any(|(px, want)| px[..3] != want.0[..3]),
            "q80 reproduced the colour exactly, so this is not a lossy encode"
        );
    }

    #[test]
    fn an_opaque_source_gets_no_alpha_channel() {
        let out = encode_variant("minimap", &opaque(64, 64)).unwrap();
        let decoded = webp::Decoder::new(&out.bytes).decode().unwrap();
        assert!(!decoded.is_alpha());
    }

    #[test]
    fn carries_no_exif_icc_or_xmp_out() {
        for variant in ["buildpic", "minimap"] {
            let out = encode_variant(variant, &cutout(64)).unwrap();
            let chunks = riff_chunks(&out.bytes);
            for unwanted in ["EXIF", "ICCP", "XMP "] {
                assert!(
                    !chunks.iter().any(|c| c == unwanted),
                    "{variant} carried a {unwanted} chunk: {chunks:?}"
                );
            }
        }
    }

    #[test]
    fn the_same_pixels_encode_to_the_same_bytes_every_time() {
        // No timestamp, no build id, nothing that would make an unchanged
        // picture look changed to the hub's content hash.
        let first = encode_variant("minimap", &opaque(96, 96)).unwrap();
        let second = encode_variant("minimap", &opaque(96, 96)).unwrap();
        assert_eq!(first.bytes, second.bytes);
    }

    #[test]
    fn downscales_past_the_cap_and_keeps_the_aspect_ratio() {
        // A minimap caps at 512, so a 1024x512 source comes back 512x256.
        let out = encode_variant("minimap", &opaque(1024, 512)).unwrap();
        assert_eq!((out.width, out.height), (512, 256));
        let decoded = webp::Decoder::new(&out.bytes).decode().unwrap();
        assert_eq!((decoded.width(), decoded.height()), (512, 256));
    }

    #[test]
    fn leaves_an_undersized_image_alone_rather_than_upscaling_it() {
        let out = encode_variant("buildpic", &cutout(64)).unwrap();
        assert_eq!((out.width, out.height), (64, 64));
    }

    #[test]
    fn an_overlay_keeps_the_resolution_the_map_grid_has() {
        // The two 8 bit overlays have no max_edge_px, so a grid wider than any
        // other class allows goes through untouched.
        let out = encode_variant("overlay:metal", &opaque(1024, 768)).unwrap();
        assert_eq!((out.width, out.height), (1024, 768));
    }

    #[test]
    fn refuses_the_height_overlay_because_it_is_16_bit_png() {
        assert_eq!(
            encode_variant("overlay:height", &opaque(64, 64)),
            Err(EncodeError::NotWebp {
                variant: "overlay:height".to_string(),
                mime: "image/png".to_string(),
            })
        );
    }

    #[test]
    fn refuses_a_variant_the_hub_would_refuse() {
        assert_eq!(
            encode_variant("overlay:wind", &opaque(8, 8)),
            Err(EncodeError::UnknownVariant("overlay:wind".to_string()))
        );
    }

    #[test]
    fn refuses_a_non_square_build_pic_rather_than_cropping_it() {
        assert_eq!(
            encode_variant("buildpic", &opaque(64, 32)),
            Err(EncodeError::NotSquare {
                width: 64,
                height: 32,
            })
        );
        // The same shape is fine for a class that does not demand a square.
        assert!(encode_variant("render:top", &opaque(64, 32)).is_ok());
    }

    #[test]
    fn refuses_an_image_with_no_pixels() {
        let empty = DynamicImage::ImageRgb8(RgbImage::new(0, 8));
        assert_eq!(
            encode_variant("minimap", &empty),
            Err(EncodeError::EmptyImage)
        );
    }

    #[test]
    fn takes_its_quality_and_caps_from_the_shared_vocabulary() {
        // Not a restatement of the JSON: the point is that this module reads
        // those numbers rather than holding its own copy, so a change to the
        // vocabulary changes the encoder.
        let render = class_for_variant("render:top").unwrap();
        assert_eq!(render.quality, Some(80));
        assert_eq!(render.max_edge_px, Some(256));
        let minimap = class_for_variant("minimap").unwrap();
        assert_eq!(minimap.quality, Some(80));
        assert_eq!(minimap.max_edge_px, Some(512));
        assert!(class_for_variant("buildpic").unwrap().lossless);
    }

    #[test]
    fn every_encode_fits_the_cap_the_hub_applies() {
        for variant in ["buildpic", "render:top", "minimap"] {
            let class = class_for_variant(variant).unwrap();
            let cap = class.max_bytes.unwrap_or(vocabulary().max_object_bytes);
            let out = encode_variant(variant, &cutout(512)).unwrap();
            assert!(out.bytes.len() as u64 <= cap, "{variant}");
        }
    }
}
