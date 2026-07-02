//! Game-branding catalog + image proxy support.
//!
//! Two concerns live here: fetching/caching the remote `catalog.json`, and
//! fetching remote branding images and caching them once as `data:` URLs (which
//! sidestep CSP host-allowlisting — the catalog can reference any host).

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;

/// Stable filesystem-safe key for a URL (hex of the std hasher). Used to name the
/// per-URL image cache files; a changed catalog URL naturally misses and refetches.
pub(crate) fn url_key(url: &str) -> String {
    let mut h = DefaultHasher::new();
    url.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Standard base64 (RFC 4648, with padding). Small hand-rolled encoder so we don't
/// add a crate just to build `data:` URLs.
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

/// Build a `data:` URL from a content type and image bytes.
pub(crate) fn data_url(content_type: &str, bytes: &[u8]) -> String {
    format!("data:{};base64,{}", content_type, base64_encode(bytes))
}

/// Downsample bound + JPEG quality for re-encoded photographic art (banners,
/// screenshots), mirroring the loadpicture header pipeline in the unitsync worker.
const PHOTO_MAX_W: u32 = 1920;
const PHOTO_MAX_H: u32 = 1080;
const PHOTO_JPEG_QUALITY: u8 = 85;

/// Decode arbitrary raster bytes, downscale to fit `PHOTO_MAX_W`x`PHOTO_MAX_H`
/// (aspect-preserving, never upscaled), drop alpha, and re-encode as a JPEG
/// `data:` URL. Returns `None` if the bytes aren't a decodable raster (e.g. SVG or
/// WebP) so the caller can fall back to passing the original bytes through. Used
/// only for opaque photographic art — logos keep their original bytes/transparency.
pub(crate) fn reencode_jpeg(bytes: &[u8]) -> Option<String> {
    let img = image::load_from_memory(bytes).ok()?;
    let img = if img.width() > PHOTO_MAX_W || img.height() > PHOTO_MAX_H {
        img.thumbnail(PHOTO_MAX_W, PHOTO_MAX_H)
    } else {
        img
    };
    let rgb = img.to_rgb8();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, PHOTO_JPEG_QUALITY)
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .ok()?;
    Some(format!("data:image/jpeg;base64,{}", base64_encode(&jpeg)))
}

/// Pick a usable image content type: trust an `image/*` response header, else
/// guess from the URL extension, else default to `image/png`. Anything not
/// `image/*` returns `None` so non-image responses are rejected.
pub(crate) fn image_content_type(header: Option<&str>, url: &str) -> Option<String> {
    if let Some(h) = header {
        let ct = h
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if ct.starts_with("image/") {
            return Some(ct);
        }
        if !ct.is_empty() {
            return None; // an explicit non-image type: reject
        }
    }
    let lower = url.to_ascii_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    match ext {
        "png" => Some("image/png".into()),
        "jpg" | "jpeg" => Some("image/jpeg".into()),
        "gif" => Some("image/gif".into()),
        "webp" => Some("image/webp".into()),
        "svg" => Some("image/svg+xml".into()),
        "bmp" => Some("image/bmp".into()),
        _ => Some("image/png".into()),
    }
}

/// Bumped when the cached encoding changes so stale entries miss and refetch.
const IMAGE_CACHE_VERSION: u32 = 2;

/// A cache-dir subpath helper, mirroring the header/thumb cache layout. The
/// filename carries a version salt and a `photo`/`raw` variant so re-encoded and
/// pass-through results for the same URL never collide (and old entries invalidate).
pub(crate) fn image_cache_files(
    cache_dir: &std::path::Path,
    url: &str,
    reencode: bool,
) -> (PathBuf, PathBuf) {
    let key = url_key(url);
    let variant = if reencode { "photo" } else { "raw" };
    let stem = format!("{key}.v{IMAGE_CACHE_VERSION}.{variant}");
    (
        cache_dir.join(format!("{stem}.dataurl")),
        cache_dir.join(format!("{stem}.none")),
    )
}

/// Fetch the catalog JSON text over HTTP. Errors carry the reqwest message.
pub(crate) async fn fetch_catalog_text(url: &str) -> Result<String, String> {
    let resp = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let resp = resp.error_for_status().map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

/// Result of resolving the catalog: the raw JSON text plus where it came from.
/// The frontend parses/validates the JSON, so Rust stays schema-agnostic.
#[derive(serde::Serialize)]
pub(crate) struct CatalogResult {
    pub json: String,
    pub source: String, // "network" | "cache" | "seed" | "error"
    pub errors: Vec<String>,
}

/// Fetch → cache → seed. Never hard-fails: on network error, returns the disk
/// cache, then the bundled seed, then an empty catalog with the errors attached.
pub(crate) async fn resolve_catalog(
    url: &str,
    cache_file: Option<PathBuf>,
    seed_file: Option<PathBuf>,
) -> CatalogResult {
    match fetch_catalog_text(url).await {
        Ok(text) => {
            if let Some(f) = &cache_file {
                if let Some(dir) = f.parent() {
                    let _ = std::fs::create_dir_all(dir);
                }
                let _ = std::fs::write(f, &text);
            }
            CatalogResult {
                json: text,
                source: "network".into(),
                errors: vec![],
            }
        }
        Err(e) => {
            if let Some(f) = &cache_file {
                if let Ok(text) = std::fs::read_to_string(f) {
                    return CatalogResult {
                        json: text,
                        source: "cache".into(),
                        errors: vec![e],
                    };
                }
            }
            if let Some(f) = &seed_file {
                if let Ok(text) = std::fs::read_to_string(f) {
                    return CatalogResult {
                        json: text,
                        source: "seed".into(),
                        errors: vec![e],
                    };
                }
            }
            CatalogResult {
                json: r#"{"version":1,"entries":[]}"#.into(),
                source: "error".into(),
                errors: vec![e],
            }
        }
    }
}

/// Fetch the first URL that yields an image, cache it once as a `data:` URL, and
/// return it. `.dataurl` positive hits and `.none` negative markers avoid refetch.
/// Only `https` URLs are attempted (privacy/security).
pub(crate) async fn resolve_image(
    urls: &[String],
    cache_dir: Option<PathBuf>,
    reencode: bool,
) -> Option<String> {
    for url in urls {
        if !url.starts_with("https://") {
            continue;
        }
        let files = cache_dir
            .as_ref()
            .map(|d| image_cache_files(d, url, reencode));
        if let Some((pos, neg)) = &files {
            if let Ok(text) = std::fs::read_to_string(pos) {
                return Some(text);
            }
            if neg.exists() {
                continue;
            }
        }
        match fetch_image(url, reencode).await {
            Some(data_url) => {
                if let Some((pos, _)) = &files {
                    if let Some(dir) = pos.parent() {
                        let _ = std::fs::create_dir_all(dir);
                    }
                    let _ = std::fs::write(pos, &data_url);
                }
                return Some(data_url);
            }
            None => {
                if let Some((_, neg)) = &files {
                    if let Some(dir) = neg.parent() {
                        let _ = std::fs::create_dir_all(dir);
                    }
                    let _ = std::fs::write(neg, b"");
                }
            }
        }
    }
    None
}

/// Fetch one image URL → `data:` URL, or `None` on any failure / non-image. When
/// `reencode` is set the bytes are downsampled and JPEG-encoded (for opaque
/// photographic art); if they can't be decoded (SVG/WebP) we pass them through raw.
async fn fetch_image(url: &str, reencode: bool) -> Option<String> {
    let resp = reqwest::get(url).await.ok()?.error_for_status().ok()?;
    let header = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let content_type = image_content_type(header.as_deref(), url)?;
    let bytes = resp.bytes().await.ok()?;
    if reencode {
        if let Some(jpeg) = reencode_jpeg(&bytes) {
            return Some(jpeg);
        }
    }
    Some(data_url(&content_type, &bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn data_url_has_prefix() {
        assert_eq!(data_url("image/png", b"foo"), "data:image/png;base64,Zm9v");
    }

    #[test]
    fn url_key_is_stable_and_differs() {
        assert_eq!(url_key("https://a/x.png"), url_key("https://a/x.png"));
        assert_ne!(url_key("https://a/x.png"), url_key("https://a/y.png"));
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
        let url = reencode_jpeg(&png_bytes(3840, 2160)).unwrap();
        assert!(url.starts_with("data:image/jpeg;base64,"));
        let b64 = url.trim_start_matches("data:image/jpeg;base64,");
        let bytes = base64_decode(b64);
        let out = image::load_from_memory(&bytes).unwrap();
        assert!(out.width() <= PHOTO_MAX_W && out.height() <= PHOTO_MAX_H);
        assert_eq!(out.width(), PHOTO_MAX_W); // 16:9 source hits the width bound
    }

    #[test]
    fn reencode_keeps_small_images_unscaled() {
        let url = reencode_jpeg(&png_bytes(320, 200)).unwrap();
        let b64 = url.trim_start_matches("data:image/jpeg;base64,");
        let out = image::load_from_memory(&base64_decode(b64)).unwrap();
        assert_eq!((out.width(), out.height()), (320, 200));
    }

    #[test]
    fn reencode_rejects_undecodable_bytes() {
        assert!(reencode_jpeg(b"not an image").is_none());
    }

    #[test]
    fn cache_files_separate_variant_and_version() {
        let dir = std::path::Path::new("/tmp");
        let (photo, _) = image_cache_files(dir, "https://a/x.png", true);
        let (raw, _) = image_cache_files(dir, "https://a/x.png", false);
        assert_ne!(photo, raw);
        assert!(photo.to_string_lossy().contains(".photo."));
        assert!(raw.to_string_lossy().contains(".raw."));
        assert!(photo
            .to_string_lossy()
            .contains(&format!(".v{IMAGE_CACHE_VERSION}.")));
    }

    /// Minimal standard-base64 decoder, test-only, to round-trip `base64_encode`.
    fn base64_decode(s: &str) -> Vec<u8> {
        const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let val = |c: u8| T.iter().position(|&t| t == c).unwrap() as u32;
        let clean: Vec<u8> = s.bytes().filter(|&c| c != b'=').collect();
        let mut out = Vec::with_capacity(clean.len() / 4 * 3);
        for chunk in clean.chunks(4) {
            let mut n = 0u32;
            for (i, &c) in chunk.iter().enumerate() {
                n |= val(c) << (18 - 6 * i);
            }
            out.push((n >> 16) as u8);
            if chunk.len() > 2 {
                out.push((n >> 8) as u8);
            }
            if chunk.len() > 3 {
                out.push(n as u8);
            }
        }
        out
    }

    #[test]
    fn content_type_prefers_image_header_then_extension() {
        assert_eq!(
            image_content_type(Some("image/webp"), "u"),
            Some("image/webp".into())
        );
        assert_eq!(
            image_content_type(Some("image/jpeg; charset=x"), "u"),
            Some("image/jpeg".into())
        );
        assert_eq!(image_content_type(Some("text/html"), "u.png"), None);
        assert_eq!(
            image_content_type(None, "https://x/logo.WEBP"),
            Some("image/webp".into())
        );
        assert_eq!(
            image_content_type(None, "https://x/noext"),
            Some("image/png".into())
        );
    }
}
