//! Campaign image handling: decode arbitrary raster input, bound its size, and
//! re-encode compactly. Both import paths (a file the user picked, and an embedded
//! base64 `data:` URI from an imported campaign) funnel through [`reencode_image`]
//! so nothing hostile can write unbounded data to disk.
//!
//! Photographic art (panorama backdrops, campaign backgrounds) re-encodes to opaque
//! JPEG; icons and mission side graphics keep their alpha as PNG so a logo/emblem
//! isn't flattened onto black. [`ImageKind`] selects the bound and encoder.
//!
//! The base64 helpers are hand-rolled (mirroring the content plugin's `branding`
//! module) so we don't pull a crate just to build/parse `data:` URLs.

use image::ImageEncoder;

/// The role an imported image plays, which sets its size bound and encoding.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum ImageKind {
    /// Ultra-wide briefing backdrop; opaque JPEG.
    Panorama,
    /// Campaign detail background; opaque JPEG.
    Background,
    /// Campaign list emblem; alpha-preserving PNG.
    Icon,
    /// Graphic beside a mission briefing; alpha-preserving PNG.
    SideGraphic,
}

/// JPEG quality for the opaque (photographic) kinds.
const JPEG_QUALITY: u8 = 82;

impl ImageKind {
    /// Parse the frontend's kind tag. An unknown or absent tag falls back to
    /// `Panorama` — the original single-kind behaviour, so older callers that send
    /// no kind are unaffected.
    pub(crate) fn parse(tag: Option<&str>) -> Self {
        match tag {
            Some("background") => Self::Background,
            Some("icon") => Self::Icon,
            Some("sideGraphic") => Self::SideGraphic,
            _ => Self::Panorama,
        }
    }

    /// Max (width, height) the image is downscaled to fit (aspect-preserving, never
    /// upscaled). Panorama is wide-and-short because briefings are ultra-wide strips.
    fn bounds(self) -> (u32, u32) {
        match self {
            Self::Panorama => (8192, 1440),
            Self::Background => (2560, 1440),
            Self::Icon => (512, 512),
            Self::SideGraphic => (1024, 1024),
        }
    }

    /// Whether to keep alpha (PNG) rather than flatten to opaque JPEG.
    fn keeps_alpha(self) -> bool {
        matches!(self, Self::Icon | Self::SideGraphic)
    }

    /// The stored file extension, matching the encoder `keeps_alpha` selects.
    pub(crate) fn ext(self) -> &'static str {
        if self.keeps_alpha() {
            "png"
        } else {
            "jpg"
        }
    }
}

/// Standard base64 (RFC 4648, with padding).
pub(crate) fn base64_encode(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            T[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// Decode standard base64 (ignoring padding and any whitespace/newlines). Returns
/// `None` on an invalid character or a truncated final group.
pub(crate) fn base64_decode(s: &str) -> Option<Vec<u8>> {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let val = |c: u8| T.iter().position(|&t| t == c).map(|p| p as u32);
    let clean: Vec<u8> = s
        .bytes()
        .filter(|c| !c.is_ascii_whitespace() && *c != b'=')
        .collect();
    let mut out = Vec::with_capacity(clean.len() / 4 * 3);
    for chunk in clean.chunks(4) {
        if chunk.len() < 2 {
            return None; // a lone trailing char can't encode a byte
        }
        let mut n = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            n |= val(c)? << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(n as u8);
        }
    }
    Some(out)
}

/// Build a `data:` URL from a content type and image bytes.
pub(crate) fn data_url(content_type: &str, bytes: &[u8]) -> String {
    format!("data:{};base64,{}", content_type, base64_encode(bytes))
}

/// Extract the base64 payload of a `data:...;base64,<payload>` URI. Returns `None`
/// if the string isn't a base64 data URI (the only kind campaign import embeds).
pub(crate) fn data_uri_bytes(uri: &str) -> Option<Vec<u8>> {
    let rest = uri.strip_prefix("data:")?;
    let comma = rest.find(',')?;
    let (meta, payload) = rest.split_at(comma);
    if !meta.contains(";base64") {
        return None;
    }
    base64_decode(&payload[1..])
}

/// Decode arbitrary raster bytes, downscale to fit the kind's bound
/// (aspect-preserving, never upscaled), and re-encode: opaque JPEG for the
/// photographic kinds, alpha-preserving PNG for icons/side graphics. Returns
/// `None` if the bytes aren't a decodable raster.
pub(crate) fn reencode_image(bytes: &[u8], kind: ImageKind) -> Option<Vec<u8>> {
    let (max_w, max_h) = kind.bounds();
    let img = image::load_from_memory(bytes).ok()?;
    let img = if img.width() > max_w || img.height() > max_h {
        img.thumbnail(max_w, max_h)
    } else {
        img
    };
    let mut out = Vec::new();
    if kind.keeps_alpha() {
        let rgba = img.to_rgba8();
        image::codecs::png::PngEncoder::new(&mut out)
            .write_image(
                rgba.as_raw(),
                rgba.width(),
                rgba.height(),
                image::ExtendedColorType::Rgba8,
            )
            .ok()?;
    } else {
        let rgb = img.to_rgb8();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY)
            .encode(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .ok()?;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trips() {
        for v in [
            &b""[..],
            &b"f"[..],
            &b"fo"[..],
            &b"foo"[..],
            &b"foob"[..],
            &b"foobar"[..],
        ] {
            assert_eq!(base64_decode(&base64_encode(v)).unwrap(), v);
        }
    }

    #[test]
    fn base64_decode_rejects_bad_input() {
        assert!(base64_decode("!!!!").is_none());
        assert!(base64_decode("A").is_none());
    }

    #[test]
    fn data_uri_bytes_parses_base64_payload() {
        let uri = format!("data:image/png;base64,{}", base64_encode(b"hi"));
        assert_eq!(data_uri_bytes(&uri).unwrap(), b"hi");
    }

    #[test]
    fn data_uri_bytes_rejects_non_base64() {
        assert!(data_uri_bytes("data:text/plain,hello").is_none());
        assert!(data_uri_bytes("not a data uri").is_none());
    }

    /// Encode a solid-colour RGBA image to in-memory PNG bytes for the tests.
    fn png_bytes(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([10, 20, 30, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[test]
    fn reencode_downsamples_oversized_and_emits_jpeg() {
        // An ultra-wide source that exceeds the panorama width bound (8192).
        let jpeg = reencode_image(&png_bytes(10000, 1000), ImageKind::Panorama).unwrap();
        let out = image::load_from_memory(&jpeg).unwrap();
        assert!(out.width() <= 8192 && out.height() <= 1440);
        assert_eq!(out.width(), 8192); // 10:1 source hits the width bound
    }

    #[test]
    fn reencode_bounds_tall_source_by_height() {
        let jpeg = reencode_image(&png_bytes(2000, 4000), ImageKind::Panorama).unwrap();
        let out = image::load_from_memory(&jpeg).unwrap();
        assert!(out.width() <= 8192 && out.height() <= 1440);
        assert_eq!(out.height(), 1440); // tall source hits the height bound
    }

    #[test]
    fn reencode_keeps_small_images_unscaled() {
        let jpeg = reencode_image(&png_bytes(640, 200), ImageKind::Panorama).unwrap();
        let out = image::load_from_memory(&jpeg).unwrap();
        assert_eq!((out.width(), out.height()), (640, 200));
    }

    #[test]
    fn reencode_rejects_undecodable_bytes() {
        assert!(reencode_image(b"not an image", ImageKind::Panorama).is_none());
    }

    #[test]
    fn icon_kind_preserves_alpha_as_png_and_bounds_at_512() {
        // A semi-transparent, oversized icon: must come back as RGBA PNG within 512.
        let img = image::RgbaImage::from_pixel(1024, 1024, image::Rgba([10, 20, 30, 128]));
        let mut src = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut src, image::ImageFormat::Png)
            .unwrap();

        let png = reencode_image(&src.into_inner(), ImageKind::Icon).unwrap();
        let out = image::load_from_memory(&png).unwrap();
        assert!(out.width() <= 512 && out.height() <= 512);
        assert_eq!(out.color(), image::ColorType::Rgba8);
        // The alpha survived the round-trip (a JPEG re-encode would have dropped it).
        assert_eq!(out.to_rgba8().get_pixel(0, 0)[3], 128);
    }

    #[test]
    fn kind_parse_and_ext_map_as_expected() {
        assert_eq!(ImageKind::parse(None), ImageKind::Panorama);
        assert_eq!(ImageKind::parse(Some("nonsense")), ImageKind::Panorama);
        assert_eq!(ImageKind::parse(Some("background")), ImageKind::Background);
        assert_eq!(ImageKind::parse(Some("icon")), ImageKind::Icon);
        assert_eq!(
            ImageKind::parse(Some("sideGraphic")),
            ImageKind::SideGraphic
        );
        assert_eq!(ImageKind::Panorama.ext(), "jpg");
        assert_eq!(ImageKind::Background.ext(), "jpg");
        assert_eq!(ImageKind::Icon.ext(), "png");
        assert_eq!(ImageKind::SideGraphic.ext(), "png");
    }
}
