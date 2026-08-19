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
//! `overlay:height` is not encodable by [`encode_variant`] and returns
//! [`EncodeError::WrongEncoder`]. [`encode_height_picture`] is its encoder, and
//! the refusal stays put now that both produce WebP: the two entry points take
//! different pixels (`u8` channels against `u16` samples), and a height grid
//! handed to [`encode_variant`] as an image would be flattened to its high byte
//! on the way in, which is the loss issue #1730 exists to stop.

// The metal map and minimap extraction paths are issues #1626 and #1630, which
// land after this, so some variants here still have no caller in the binary.
// The tests exercise all of it.
#![allow(dead_code)]

use coilbox_assets::{class_for_variant, vocabulary, AssetClass};
use image::{DynamicImage, ImageBuffer, Luma};
use sha2::{Digest, Sha256};

/// The one variant [`encode_height_picture`] produces, and the one
/// [`encode_variant`] refuses. Spelled once so the row's `variant` and the class
/// the bytes were encoded to cannot come apart.
pub const HEIGHT_OVERLAY_VARIANT: &str = "overlay:height";

/// What the hub's `origin` column says about bytes read out of an archive as the
/// archive stored them: every build pic and every map infomap layer.
///
/// Here rather than in each extractor because coilbox-hub#117 is about exactly
/// this going four different ways at once. The test below holds both spellings to
/// the shared vocabulary rather than to a memory of it.
pub const EXTRACTED_ORIGIN: &str = "extracted";

/// What it says about bytes coilbox drew instead, which is `render:<angle>`.
pub const RENDERED_ORIGIN: &str = "rendered";

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
    /// A variant that is real but has an encoder of its own, which is
    /// `overlay:height` and only `overlay:height`.
    WrongEncoder { variant: String },
    /// A class the vocabulary says is not WebP. Only reachable by editing the
    /// vocabulary, which is the point of checking.
    NotWebp { variant: String, mime: String },
    /// The sample buffer is not `width * height` long, so what it is a picture of
    /// is unknown.
    SizeMismatch { got: usize, expected: usize },
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
            Self::WrongEncoder { variant } => write!(
                f,
                "variant {variant} is encoded from the map's 16 bit samples, not from an image"
            ),
            Self::NotWebp { variant, mime } => write!(f, "variant {variant} is {mime}, not WebP"),
            Self::SizeMismatch { got, expected } => {
                write!(f, "got {got} samples, expected {expected}")
            }
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
    if variant == HEIGHT_OVERLAY_VARIANT {
        return Err(EncodeError::WrongEncoder {
            variant: variant.to_string(),
        });
    }
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

/// The window a height picture's 0 and its 255 stand for, in the raw sample
/// words the map stores.
///
/// Without it the picture is a shape rather than a terrain. It comes back from
/// [`encode_height_picture`] because only the encoder knows it: the window is the
/// extremes of the samples that survived the downscale, not the extremes of the
/// grid that went in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HeightWindow {
    pub low: u16,
    pub high: u16,
}

impl HeightWindow {
    /// The world heights the picture's 0 and 255 stand for, given the pair
    /// unitsync reports for the whole map.
    ///
    /// `CSMFMapFile::ReadHeightmap`'s own arithmetic, which
    /// `rts/Map/SMF/SMFReadMap.cpp:157` spells as
    /// `minHeight + word * (maxHeight - minHeight) / 65536`. A reader that
    /// follows it back holds the height the engine holds, to within the step the
    /// eight bits cost.
    pub fn elmos(self, min_height: f32, max_height: f32) -> (f32, f32) {
        let step = (max_height - min_height) / 65536.0;
        (
            min_height + f32::from(self.low) * step,
            min_height + f32::from(self.high) * step,
        )
    }
}

/// Encode a map's height samples as the hub's `overlay:height` asset: 8 bit grey
/// lossless WebP, rescaled into the window the samples occupy (issue #1730).
///
/// This is a second entry point rather than a branch inside [`encode_variant`],
/// which keeps refusing this variant. The two take different pixels: everything
/// else in the corpus arrives as 8 bit channels in a [`DynamicImage`], and a
/// height grid is `u16` samples that have to stay `u16` until the rescale. A
/// grid handed in as an image would already have been flattened to its high
/// byte, and the refusal exists to make that impossible rather than unlikely.
///
/// Eight bits because no reader ever got more. A browser decodes a 16 bit PNG to
/// eight bits a channel and keeps the high byte, canvas `ImageData` is a
/// `Uint8ClampedArray` and a three.js texture is `UnsignedByteType`, so the
/// second byte was being paid for and thrown away. Rescaling into the samples'
/// own window is strictly better than that truncation, and costs nothing.
///
/// The rescale is lossy and the loss is not height error: the worst map in a 101
/// map corpus lands within 4 elmos, which nobody can see. What shows is banding,
/// where a gentle slope collapses into flat steps that shading turns into rings.
/// A reader that needs the exact words asks the worker's `--height-field` mode,
/// which hands over the map's own bytes.
pub fn encode_height_picture(
    samples: &[u16],
    width: u32,
    height: u32,
) -> Result<(EncodedAsset, HeightWindow), EncodeError> {
    let class = class_for_variant(HEIGHT_OVERLAY_VARIANT)
        .ok_or_else(|| EncodeError::UnknownVariant(HEIGHT_OVERLAY_VARIANT.to_string()))?;
    if class.mime != "image/webp" {
        return Err(EncodeError::NotWebp {
            variant: HEIGHT_OVERLAY_VARIANT.to_string(),
            mime: class.mime.clone(),
        });
    }
    if width == 0 || height == 0 {
        return Err(EncodeError::EmptyImage);
    }
    let expected = (width as usize) * (height as usize);
    if samples.len() != expected {
        return Err(EncodeError::SizeMismatch {
            got: samples.len(),
            expected,
        });
    }

    let (words, w, h) = fit_samples_to_cap(samples, width, height, class.max_edge_px)?;
    let window = HeightWindow {
        low: words.iter().copied().min().unwrap_or(0),
        high: words.iter().copied().max().unwrap_or(0),
    };
    // libwebp takes no grey input, so the one channel goes in as three equal
    // ones. VP8L's colour transform reduces that back to close to a single
    // plane, which is why a grey lossless WebP is not three times the size of
    // one.
    let rgb: Vec<u8> = rescale(&words, window)
        .into_iter()
        .flat_map(|v| [v, v, v])
        .collect();
    let bytes = webp::Encoder::from_rgb(&rgb, w, h)
        .encode_simple(true, 0.0)
        .map_err(|e| EncodeError::Libwebp(format!("{e:?}")))?
        .to_vec();

    let cap = class.max_bytes.unwrap_or(vocabulary().max_object_bytes);
    if bytes.len() as u64 > cap {
        return Err(EncodeError::TooLarge {
            bytes: bytes.len() as u64,
            cap,
        });
    }

    Ok((
        EncodedAsset {
            bytes,
            encode_profile: class.encode_profile.clone(),
            mime: class.mime.clone(),
            width: w,
            height: h,
        },
        window,
    ))
}

/// The samples the picture is encoded from, downscaled to the class's cap while
/// they are still 16 bit.
///
/// Downscaling first and rescaling after is what makes the window the picture's
/// own. Averaging in 16 bits also keeps a slope a slope: rescale first and the
/// averaging happens between values that have already been rounded to a step.
///
/// `thumbnail` rather than the Lanczos3 [`fit_to_cap`] uses on pictures, because
/// a windowed sinc rings, and a ring beside a cliff is a terrace of ground the
/// map does not have.
fn fit_samples_to_cap(
    samples: &[u16],
    width: u32,
    height: u32,
    max_edge_px: Option<u32>,
) -> Result<(Vec<u16>, u32, u32), EncodeError> {
    let grid = ImageBuffer::<Luma<u16>, _>::from_raw(width, height, samples.to_vec()).ok_or(
        EncodeError::SizeMismatch {
            got: samples.len(),
            expected: (width as usize) * (height as usize),
        },
    )?;
    let fits = max_edge_px.is_none_or(|cap| width <= cap && height <= cap);
    if fits {
        return Ok((grid.into_raw(), width, height));
    }
    let cap = max_edge_px.unwrap_or(u32::MAX);
    let scaled = DynamicImage::ImageLuma16(grid).thumbnail(cap, cap);
    let (w, h) = (scaled.width(), scaled.height());
    let words = scaled
        .as_luma16()
        .ok_or_else(|| EncodeError::Libwebp("the downscale dropped the 16 bit samples".into()))?
        .as_raw()
        .clone();
    Ok((words, w, h))
}

/// The samples as bytes across the window they occupy, rounded to nearest.
///
/// Rounding rather than truncating halves the error the eight bits cost, which
/// is free and is half the reason this beats the high byte a browser would have
/// kept. A grid with no relief at all is one value, and every byte of it is 0.
fn rescale(words: &[u16], window: HeightWindow) -> Vec<u8> {
    let span = u32::from(window.high - window.low);
    if span == 0 {
        return vec![0u8; words.len()];
    }
    words
        .iter()
        .map(|&word| ((u32::from(word - window.low) * 255 + span / 2) / span) as u8)
        .collect()
}

/// Lowercase hex sha256, which is what the hub records in both hash columns and
/// uses as the object's path component.
///
/// Two different bytes get hashed per asset and the difference is load bearing:
/// `source_hash` is over the archive member exactly as it was read, and `hash`
/// is over what [`encode_variant`] produced. Only the first is stable across
/// coilbox releases, so it is the one dedupe and the have check compare on.
pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// `source_hash` for a map layer read off a sample grid: the samples, framed by
/// which layer they are and how wide and tall the grid is (issue #1660).
///
/// The samples on their own are not an identity. Two maps with a uniform layer
/// and transposed grids hold the same bytes and are different pictures, which
/// this library has two live pairs of: `overlay:type` for Crystallized Plains 1.1
/// at 384x448 against Heartbreak Hill v4.0.1 at 448x384, and All That Simmers
/// v1.1.1 at 448x640 against Industrial_Revolution_V2 at 640x448. Nothing about
/// the grid reached the hash, so both pairs shared one, and the have check at
/// #1632 would have read one map's layer as another map's.
///
/// The frame is `variant` bytes, a `0x00`, `width` and `height` as little endian
/// `u32`, then the samples. Every field is fixed width or self delimiting: a
/// variant name is ASCII from the vocabulary's closed list and holds no `0x00`,
/// so the terminator ends it, and the two lengths are four bytes each, so what is
/// left is the samples. One byte stream therefore has exactly one reading.
/// Decimal digits run together instead would not: `12` then `34` and `1` then
/// `234` are one string.
///
/// Little endian for the lengths, matching how #1627 serialises the height
/// samples themselves, so the hash is the same on every architecture coilbox
/// builds for.
///
/// The variant is in the frame because metal and type sit on the same
/// `(mapx/2, mapy/2)` grid at one byte a sample, so a map whose terrain is one
/// type and whose metal is one density holds the same bytes in both layers. Five
/// rows in this library did, and a density of 0 and terrain type 0 are not the
/// same fact about a map. Naming the layer keeps each one's identity its own.
///
/// Nothing in the frame comes from the encoder. The variant is the hub's own
/// vocabulary and the grid is the map's, so two coilbox releases with different
/// encoders still produce the same `source_hash` from the same map, which is the
/// whole reason the hub compares on this hash and not on the encoded one.
pub fn map_source_hash(variant: &str, width: u32, height: u32, samples: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(variant.as_bytes());
    hasher.update([0u8]);
    hasher.update(width.to_le_bytes());
    hasher.update(height.to_le_bytes());
    hasher.update(samples);
    format!("{:x}", hasher.finalize())
}

/// `source_hash` for a top down render (issue #1631).
///
/// A render is the one asset in the corpus that is not read out of an archive, so
/// there is no member to hash. It is a function of a model, a camera and a
/// renderer, and the identity has to be over those inputs rather than over the
/// pixels that came out.
///
/// **Hashing the pixels would be wrong**, and not subtly. The render runs on the
/// user's GPU: two people with the same archives and the same coilbox produce
/// slightly different pixels, so a pixel hash would make one unit two identities
/// and the have check at #1632 would ask everybody to upload everything. Hashing
/// the inputs makes the value the same on every machine, which is the property
/// dedupe rests on.
///
/// The frame is `variant` bytes, a `0x00`, then `renderer_version`,
/// `footprint_x`, `footprint_z`, `width_px` and `height_px` as little endian
/// `u32`, then `model_digest` as its 64 lowercase hex characters. Every field
/// after the terminator is fixed width, so one byte stream has one reading, the
/// same rule [`map_source_hash`] follows for #1660.
///
/// What each field is doing:
///
/// - `model_digest` is [`model_source_digest`] over the model and its textures,
///   so a game shipping a new model or a re-skin moves the identity.
/// - `footprint_x` and `footprint_z` are what the camera is aimed with, and two
///   footprints can frame to one pixel size, so the frame carries both rather
///   than trusting the dimensions to imply them.
/// - `width_px` and `height_px` move when the vocabulary's framing does, so a
///   change to the bleed or the edge cap moves the identity with nobody having to
///   remember to say so.
/// - `renderer_version` is the part a person has to keep honest, and it is the
///   answer to "how is a renderer change told from an encoder change". An
///   encoder change moves `encode_profile` and leaves this hash alone, by
///   design: the have check compares `source_hash`, so re-encoding the corpus at
///   q85 must not report the corpus as changed. A renderer change is the
///   opposite case and must move it, so whoever changes the camera, the lights
///   or the texture handling bumps `RENDER_VERSION` in
///   `src/hub/assets/renderTop.ts`, beside the code it describes.
pub fn render_source_hash(
    variant: &str,
    renderer_version: u32,
    footprint_x: u32,
    footprint_z: u32,
    width_px: u32,
    height_px: u32,
    model_digest: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(variant.as_bytes());
    hasher.update([0u8]);
    hasher.update(renderer_version.to_le_bytes());
    hasher.update(footprint_x.to_le_bytes());
    hasher.update(footprint_z.to_le_bytes());
    hasher.update(width_px.to_le_bytes());
    hasher.update(height_px.to_le_bytes());
    hasher.update(model_digest.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// What the render was taken of: the model file and every texture it draws with,
/// by content.
///
/// The archive bytes rather than anything coilbox derived from them, for the same
/// reason the build pic hashes its member: a decoder or a transcoder change would
/// otherwise move the identity of every unit in the corpus. Those are renderer
/// changes and `renderer_version` is where they are declared.
///
/// Textures are in ascending order of their archive member path so the digest
/// does not depend on the order the model happened to name them, and each is
/// length prefixed so two textures cannot run together into one reading. The
/// count is in the frame as well, so a texture that failed to resolve, and is
/// therefore drawn plain, is a different picture from one that resolved.
///
/// `textures` is anything that reads as bytes rather than owned buffers, so a
/// batch can hand over textures it is holding for the next model as well as ones
/// it has just read (issue #1676). The frame is over the bytes either way.
pub fn model_source_digest<T: AsRef<[u8]>>(model: &[u8], textures: &[T]) -> String {
    let mut hasher = Sha256::new();
    hasher.update((model.len() as u64).to_le_bytes());
    hasher.update(model);
    hasher.update((textures.len() as u32).to_le_bytes());
    for texture in textures {
        let texture = texture.as_ref();
        hasher.update((texture.len() as u64).to_le_bytes());
        hasher.update(texture);
    }
    format!("{:x}", hasher.finalize())
}

/// The file extension for an asset class's mime, for naming the file on disk.
pub fn ext_for_mime(mime: &str) -> &str {
    mime.rsplit('/').next().unwrap_or("bin")
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

    /// A model that draws with no texture at all. Spelled with a type because
    /// `model_source_digest` takes anything that reads as bytes, so an empty
    /// slice on its own does not say what it is empty of.
    const NO_TEXTURES: &[Vec<u8>] = &[];

    #[test]
    fn the_origins_this_worker_writes_are_the_shared_vocabularys_own() {
        // A spelling the hub's check constraint would refuse is a whole run's
        // worth of rows rejected on arrival, so the strings are held to the
        // vocabulary rather than to a memory of it (coilbox-hub#117).
        let origins = &vocabulary().origins;
        assert!(origins.iter().any(|o| o == EXTRACTED_ORIGIN));
        assert!(origins.iter().any(|o| o == RENDERED_ORIGIN));
    }

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

    /// Both entry points produce WebP now, and the refusal is still the point:
    /// a height grid that arrives as an image has already lost its low byte.
    #[test]
    fn refuses_the_height_overlay_because_it_has_its_own_encoder() {
        assert_eq!(
            encode_variant("overlay:height", &opaque(64, 64)),
            Err(EncodeError::WrongEncoder {
                variant: "overlay:height".to_string(),
            })
        );
    }

    /// Height samples with the shape a real map has: a smooth ramp, so
    /// neighbouring vertices differ by less than 256 and truncating to 8 bits
    /// would flatten the slope into steps.
    fn heights(w: u32, h: u32) -> Vec<u16> {
        (0..w * h)
            .map(|i| {
                let (x, y) = (i % w, i / w);
                ((x * 65535 / w.max(1)) as u16).wrapping_add((y * 37) as u16)
            })
            .collect()
    }

    /// The samples a height picture decodes back to, as raw words in the window
    /// the encoder reported.
    fn decoded_words(bytes: &[u8], window: HeightWindow) -> Vec<u16> {
        let decoded = webp::Decoder::new(bytes).decode().expect("decode webp");
        let span = f64::from(window.high - window.low);
        decoded
            .chunks_exact(if decoded.is_alpha() { 4 } else { 3 })
            .map(|px| {
                assert!(px[0] == px[1] && px[1] == px[2], "the picture is not grey");
                window.low + (f64::from(px[0]) / 255.0 * span).round() as u16
            })
            .collect()
    }

    /// The whole of #1730: eight bits across the samples' own window beats the
    /// high byte a browser would have kept, and the error it costs is a step of
    /// that window rather than a step of the whole 16 bit range.
    #[test]
    fn gives_back_the_heights_to_within_one_step_of_their_own_window() {
        let (w, h) = (64u32, 48u32);
        let samples = heights(w, h);
        let (out, window) = encode_height_picture(&samples, w, h).unwrap();
        assert_eq!((out.width, out.height), (w, h));

        let (low, high) = (
            *samples.iter().min().unwrap(),
            *samples.iter().max().unwrap(),
        );
        assert_eq!(window, HeightWindow { low, high });

        let step = f64::from(high - low) / 255.0;
        for (got, want) in decoded_words(&out.bytes, window).iter().zip(&samples) {
            assert!(
                (f64::from(*got) - f64::from(*want)).abs() <= step,
                "{got} is more than one step of {step} from {want}"
            );
        }

        // And the check above had something to prove: neighbouring rows differ
        // by less than a step of the window, so a scheme that rounded to the
        // step alone could not have passed it.
        let stride = w as usize;
        assert!(
            samples[..samples.len() - stride]
                .iter()
                .zip(&samples[stride..])
                .any(|(a, b)| {
                    let apart = a.abs_diff(*b);
                    apart > 0 && f64::from(apart) < step
                }),
            "the test grid has no slope gentler than one step of {step}"
        );
    }

    /// A grid with no relief is one value everywhere, and a window of nothing
    /// cannot be divided by. Every byte is 0 and the two bounds are equal, which
    /// is a reader's cue that the map is flat.
    #[test]
    fn encodes_a_flat_map_as_a_flat_picture_rather_than_dividing_by_nothing() {
        let (out, window) = encode_height_picture(&vec![32000u16; 16 * 16], 16, 16).unwrap();
        assert_eq!(
            window,
            HeightWindow {
                low: 32000,
                high: 32000
            }
        );
        let decoded = webp::Decoder::new(&out.bytes).decode().unwrap();
        assert!(decoded.iter().all(|&b| b == 0));
    }

    /// 512 is where the terrain mesh stops being able to show more, so a full
    /// resolution grid comes down to it rather than being stored twice as fine
    /// as anything can draw.
    #[test]
    fn caps_the_picture_at_the_class_edge_and_keeps_the_aspect_ratio() {
        let (out, _) = encode_height_picture(&heights(2049, 1025), 2049, 1025).unwrap();
        assert_eq!((out.width, out.height), (512, 256));
        assert_eq!(out.mime, "image/webp");
        assert_eq!(out.encode_profile, "webp-lossless-512");
        let decoded = webp::Decoder::new(&out.bytes).decode().unwrap();
        assert_eq!((decoded.width(), decoded.height()), (512, 256));
    }

    /// The window is the picture's, not the grid's. Downscaling averages the
    /// extremes away, so a window taken before the resample would stretch the
    /// bytes across heights the picture no longer holds.
    #[test]
    fn windows_the_samples_that_survived_the_downscale() {
        let (w, h) = (1024u32, 1024u32);
        // Flat but for one spike and one pit, both of which a box average
        // dilutes into their neighbours.
        let mut samples = vec![30000u16; (w * h) as usize];
        let last = samples.len() - 1;
        samples[0] = 0;
        samples[last] = 65535;
        let (_, window) = encode_height_picture(&samples, w, h).unwrap();
        assert!(window.low > 0, "kept a low the picture does not hold");
        assert!(window.high < 65535, "kept a high the picture does not hold");
    }

    /// The bounds that turn a byte back into elmos, by the engine's own
    /// arithmetic. Half the raw range is half the world range.
    #[test]
    fn names_its_window_in_the_elmos_the_engine_would_read() {
        let window = HeightWindow {
            low: 0,
            high: 32768,
        };
        let (low, high) = window.elmos(-100.0, 100.0);
        assert_eq!((low, high), (-100.0, 0.0));
    }

    #[test]
    fn the_same_heights_encode_to_the_same_bytes_every_time() {
        let first = encode_height_picture(&heights(96, 96), 96, 96).unwrap();
        let second = encode_height_picture(&heights(96, 96), 96, 96).unwrap();
        assert_eq!(first.0.bytes, second.0.bytes);
    }

    /// Noise is the worst a height map could be, and at the class's edge cap it
    /// still comes in well under the class's byte cap. That is the measurement
    /// behind #1730's numbers: the layer stopped being the corpus's largest by
    /// an order of magnitude.
    #[test]
    fn the_worst_case_grid_still_fits_the_cap_the_hub_applies() {
        let (w, h) = (1024u32, 1024u32);
        let mut state = 0x2545_f491_4f6c_dd1du64;
        let noise: Vec<u16> = (0..w * h)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                state as u16
            })
            .collect();
        let (out, _) = encode_height_picture(&noise, w, h).unwrap();
        let cap = class_for_variant("overlay:height")
            .unwrap()
            .max_bytes
            .unwrap();
        assert!(
            out.bytes.len() as u64 <= cap,
            "{} over {cap}",
            out.bytes.len()
        );
    }

    #[test]
    fn refuses_a_height_grid_that_is_not_the_size_it_says_it_is() {
        assert_eq!(
            encode_height_picture(&heights(8, 8), 8, 9),
            Err(EncodeError::SizeMismatch {
                got: 64,
                expected: 72
            })
        );
        assert_eq!(
            encode_height_picture(&[], 0, 8),
            Err(EncodeError::EmptyImage)
        );
    }

    #[test]
    fn the_height_encoder_names_a_variant_the_hub_stores() {
        assert!(vocabulary()
            .map_variants
            .iter()
            .any(|v| v == HEIGHT_OVERLAY_VARIANT));
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
    fn hashes_match_the_published_sha256_test_vectors() {
        // NIST FIPS 180-4 example vectors, so this checks the digest against
        // something outside this repo rather than against itself.
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    /// The frame spelled out against the digest of the bytes it claims to build,
    /// so the layout is pinned rather than described. A reader of the manifest
    /// can reproduce a `source_hash` from this without the source.
    #[test]
    fn frames_a_layer_as_the_variant_then_the_grid_then_the_samples() {
        let mut want = Vec::new();
        want.extend_from_slice(b"overlay:type");
        want.push(0);
        want.extend_from_slice(&384u32.to_le_bytes());
        want.extend_from_slice(&448u32.to_le_bytes());
        want.extend_from_slice(&[7, 7, 7]);
        assert_eq!(
            map_source_hash("overlay:type", 384, 448, &[7, 7, 7]),
            sha256_hex(&want)
        );
    }

    /// One byte stream, one reading. Decimal digits run together would not give
    /// that: 12 then 34 and 1 then 234 are the same string, and the fixed width
    /// fields are why no pair of inputs can produce one frame.
    #[test]
    fn no_two_grids_frame_to_the_same_bytes() {
        let samples = vec![0u8; 12];
        let hashes = [
            map_source_hash("overlay:type", 1, 234, &samples),
            map_source_hash("overlay:type", 12, 34, &samples),
            map_source_hash("overlay:type", 123, 4, &samples),
            map_source_hash("overlay:type", 234, 1, &samples),
        ];
        let mut unique = hashes.to_vec();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), hashes.len());
    }

    /// The frame separates the layers as well as the grids. A flat metal layer
    /// and a flat type layer on one grid are the same bytes, and a density of 0
    /// is not terrain type 0.
    #[test]
    fn two_layers_on_one_grid_are_two_identities() {
        let flat = vec![0u8; 64];
        assert_ne!(
            map_source_hash("overlay:metal", 8, 8, &flat),
            map_source_hash("overlay:type", 8, 8, &flat)
        );
    }

    /// Why `source_hash` exists: it tracks the map, so two coilbox releases whose
    /// encoders disagree still report one identity for one map. The frame holds
    /// the layer's name and the map's own grid and nothing a profile decides, so
    /// putting the same pixels through two profiles moves the encoded hash and
    /// leaves the identity where it was.
    #[test]
    fn one_map_keeps_one_identity_under_two_encode_profiles() {
        let pixels = cutout(64);
        let samples: Vec<u8> = pixels.to_luma8().into_raw();

        // Lossless against q80, which is as far apart as two classes get here.
        let lossless = encode_variant("buildpic", &pixels).unwrap();
        let lossy = encode_variant("minimap", &pixels).unwrap();
        assert_ne!(sha256_hex(&lossless.bytes), sha256_hex(&lossy.bytes));
        assert_ne!(lossless.encode_profile, lossy.encode_profile);

        // The identity is the frame those two profiles are both absent from:
        // the variant, the grid and the samples, and no third thing.
        let mut frame = Vec::new();
        frame.extend_from_slice(b"minimap");
        frame.push(0);
        frame.extend_from_slice(&64u32.to_le_bytes());
        frame.extend_from_slice(&64u32.to_le_bytes());
        frame.extend_from_slice(&samples);
        assert_eq!(
            map_source_hash("minimap", 64, 64, &samples),
            sha256_hex(&frame)
        );
    }

    /// The render frame spelled out against the digest of the bytes it claims to
    /// build, so the layout is pinned rather than described.
    #[test]
    fn frames_a_render_as_the_variant_the_camera_and_the_model() {
        let digest = model_source_digest(b"an s3o", &[b"a dds".to_vec()]);
        let mut want = Vec::new();
        want.extend_from_slice(b"render:top");
        want.push(0);
        want.extend_from_slice(&1u32.to_le_bytes()); // renderer version
        want.extend_from_slice(&3u32.to_le_bytes()); // footprint x
        want.extend_from_slice(&2u32.to_le_bytes()); // footprint z
        want.extend_from_slice(&255u32.to_le_bytes());
        want.extend_from_slice(&204u32.to_le_bytes());
        want.extend_from_slice(digest.as_bytes());
        assert_eq!(
            render_source_hash("render:top", 1, 3, 2, 255, 204, &digest),
            sha256_hex(&want)
        );
    }

    /// The point of `source_hash` for a render: it is over the inputs, so it does
    /// not move when the pixels do. Two GPUs shading one model differently is the
    /// ordinary case rather than a fault, and a pixel hash would make the have
    /// check ask every user to upload the whole corpus.
    #[test]
    fn one_unit_keeps_one_identity_whatever_the_pixels_came_out_as() {
        let digest = model_source_digest(b"an s3o", NO_TEXTURES);
        let first = render_source_hash("render:top", 1, 3, 2, 255, 204, &digest);
        let second = render_source_hash("render:top", 1, 3, 2, 255, 204, &digest);
        assert_eq!(first, second);

        // And it is not the encoded bytes: those move with the profile, and the
        // identity is the thing that does not.
        let lossy = encode_variant("render:top", &cutout(64)).unwrap();
        let lossless = encode_variant("buildpic", &cutout(64)).unwrap();
        assert_ne!(sha256_hex(&lossy.bytes), sha256_hex(&lossless.bytes));
        assert_ne!(first, sha256_hex(&lossy.bytes));
    }

    /// Every field in the frame earns its place: change one and the identity
    /// moves. The footprint is in there separately from the pixels because two
    /// footprints can frame to one size, which the last pair here is.
    #[test]
    fn every_input_the_picture_depends_on_moves_the_identity() {
        let digest = model_source_digest(b"an s3o", NO_TEXTURES);
        let other = model_source_digest(b"a different s3o", NO_TEXTURES);
        let base = render_source_hash("render:top", 1, 3, 2, 255, 204, &digest);
        let variants = [
            render_source_hash("render:front", 1, 3, 2, 255, 204, &digest),
            render_source_hash("render:top", 2, 3, 2, 255, 204, &digest),
            render_source_hash("render:top", 1, 2, 3, 204, 255, &digest),
            render_source_hash("render:top", 1, 3, 2, 128, 102, &digest),
            render_source_hash("render:top", 1, 3, 2, 255, 204, &other),
            // 1 by 1 and 3 by 3 both frame to 255 by 255, so without the
            // footprint in the frame these two would be one identity.
            render_source_hash("render:top", 1, 1, 1, 255, 255, &digest),
            render_source_hash("render:top", 1, 3, 3, 255, 255, &digest),
        ];
        let mut all = vec![base];
        all.extend(variants);
        let mut unique = all.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), all.len());

        // The collision that footprint pair would have been, spelled out.
        assert_eq!(
            coilbox_assets::render_frame(1, 1).width_px,
            coilbox_assets::render_frame(3, 3).width_px
        );
    }

    /// A re-skin is a different picture of the same geometry, so the textures are
    /// in the digest. Length prefixes are what stop two textures running together
    /// into one reading.
    #[test]
    fn a_model_digest_covers_the_textures_as_well_as_the_geometry() {
        let geometry = b"an s3o".to_vec();
        assert_ne!(
            model_source_digest(&geometry, &[b"blue.dds".to_vec()]),
            model_source_digest(&geometry, &[b"red.dds".to_vec()])
        );
        // A texture that did not resolve is a unit drawn plain, which is not the
        // same picture as one that did.
        assert_ne!(
            model_source_digest(&geometry, NO_TEXTURES),
            model_source_digest(&geometry, &[b"blue.dds".to_vec()])
        );
        // Two textures cannot be re-split into one boundary that gives the same
        // bytes, because each carries its own length.
        assert_ne!(
            model_source_digest(&geometry, &[b"ab".to_vec(), b"cd".to_vec()]),
            model_source_digest(&geometry, &[b"a".to_vec(), b"bcd".to_vec()])
        );
    }

    /// A batch hands over textures it is holding for the next model rather than
    /// buffers it just read (issue #1676), so the digest has to be over the
    /// bytes and not over how they are held. If it were not, every render
    /// already uploaded would become unreachable the day the batch changed how
    /// it keeps a texture.
    #[test]
    fn the_digest_is_over_the_bytes_and_not_over_how_they_are_held() {
        let owned = vec![atlas(4096, 0xa5), atlas(4096, 0x5a)];
        let borrowed: Vec<&[u8]> = owned.iter().map(|t| t.as_slice()).collect();
        let boxed: Vec<Box<[u8]>> = owned.iter().map(|t| t.clone().into_boxed_slice()).collect();
        let want = model_source_digest(b"an s3o", &owned);
        assert_eq!(model_source_digest(b"an s3o", &borrowed), want);
        assert_eq!(model_source_digest(b"an s3o", &boxed), want);
    }

    /// A texture is 64 MiB in the worst case, so the digest has to be over the
    /// whole of it rather than over a prefix. Two atlases that differ only in
    /// their last byte are two re-skins, and a prefix would make them one
    /// picture.
    #[test]
    fn the_digest_covers_a_texture_to_its_last_byte() {
        let mut late = atlas(4096, 0xa5);
        *late.last_mut().unwrap() = 0x00;
        assert_ne!(
            model_source_digest(b"an s3o", &[atlas(4096, 0xa5)]),
            model_source_digest(b"an s3o", &[late])
        );
    }

    /// Bytes that look like a texture: long enough that a digest reading only a
    /// prefix of one would be caught, and varying so a run-length shortcut would
    /// be too.
    fn atlas(len: usize, seed: u8) -> Vec<u8> {
        (0..len).map(|i| (i as u8).wrapping_mul(31) ^ seed).collect()
    }

    #[test]
    fn names_a_file_after_the_mime_the_class_declares() {
        assert_eq!(ext_for_mime("image/webp"), "webp");
        assert_eq!(ext_for_mime("image/png"), "png");
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
