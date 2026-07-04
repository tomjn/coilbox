//! Panorama image handling: decode arbitrary raster input, bound its size, and
//! re-encode as a compact JPEG. Both import paths (a file the user picked, and an
//! embedded base64 `data:` URI from an imported campaign) funnel through
//! [`reencode_panorama`] so nothing hostile can write unbounded data to disk.
//!
//! The base64 helpers are hand-rolled (mirroring the content plugin's `branding`
//! module) so we don't pull a crate just to build/parse `data:` URLs.

/// Downscale bound + JPEG quality for imported panorama art. Wide-and-short bound
/// because briefing panoramas are ultra-wide strips; aspect ratio is always
/// preserved and images are never upscaled.
const PANO_MAX_W: u32 = 8192;
const PANO_MAX_H: u32 = 1440;
const PANO_JPEG_QUALITY: u8 = 80;

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

/// Decode arbitrary raster bytes, downscale to fit `PANO_MAX_W`x`PANO_MAX_H`
/// (aspect-preserving, never upscaled), drop alpha, and re-encode as a JPEG.
/// Returns `None` if the bytes aren't a decodable raster.
pub(crate) fn reencode_panorama(bytes: &[u8]) -> Option<Vec<u8>> {
    let img = image::load_from_memory(bytes).ok()?;
    let img = if img.width() > PANO_MAX_W || img.height() > PANO_MAX_H {
        img.thumbnail(PANO_MAX_W, PANO_MAX_H)
    } else {
        img
    };
    let rgb = img.to_rgb8();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, PANO_JPEG_QUALITY)
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .ok()?;
    Some(jpeg)
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
        // An ultra-wide source that exceeds the width bound.
        let jpeg = reencode_panorama(&png_bytes(10000, 1000)).unwrap();
        let out = image::load_from_memory(&jpeg).unwrap();
        assert!(out.width() <= PANO_MAX_W && out.height() <= PANO_MAX_H);
        assert_eq!(out.width(), PANO_MAX_W); // 10:1 source hits the width bound
    }

    #[test]
    fn reencode_bounds_tall_source_by_height() {
        let jpeg = reencode_panorama(&png_bytes(2000, 4000)).unwrap();
        let out = image::load_from_memory(&jpeg).unwrap();
        assert!(out.width() <= PANO_MAX_W && out.height() <= PANO_MAX_H);
        assert_eq!(out.height(), PANO_MAX_H); // tall source hits the height bound
    }

    #[test]
    fn reencode_keeps_small_images_unscaled() {
        let jpeg = reencode_panorama(&png_bytes(640, 200)).unwrap();
        let out = image::load_from_memory(&jpeg).unwrap();
        assert_eq!((out.width(), out.height()), (640, 200));
    }

    #[test]
    fn reencode_rejects_undecodable_bytes() {
        assert!(reencode_panorama(b"not an image").is_none());
    }
}
