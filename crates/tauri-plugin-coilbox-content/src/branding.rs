//! Game-branding catalog + image proxy support.
//!
//! Two concerns live here: fetching/caching the remote `catalog.json`, and
//! fetching remote branding images and caching them once as `data:` URLs (which
//! sidestep CSP host-allowlisting — the catalog can reference any host).

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// How long a negative image marker (`.none`) is trusted before we retry the host.
/// Without this a transiently-down image host would be cached as permanently
/// missing until a version-salt bump.
const NEGATIVE_MARKER_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// How long a disk-cached catalog is trusted before we go back to the network. It
/// no longer decides how long the caller waits, because the copy on disk always
/// answers straight away. It decides how often a launch kicks off a refetch behind
/// that answer.
const CATALOG_TTL: Duration = Duration::from_secs(6 * 60 * 60);

/// Bound the catalog fetch. Without this a network that black-holes packets rather
/// than refusing them hangs the request for the OS TCP timeout, about 75 seconds on
/// macOS. The catalog is a few tens of kilobytes, so 10 seconds covers a slow
/// tethered link, and nothing user-visible waits on it: the answer comes off disk
/// and the fetch runs behind it.
const CATALOG_FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// True when a file modified at `modified` is older than `ttl` relative to `now`.
/// A modification time in the future (clock skew) counts as fresh.
fn is_stale(modified: SystemTime, now: SystemTime, ttl: Duration) -> bool {
    now.duration_since(modified)
        .map(|age| age > ttl)
        .unwrap_or(false)
}

/// True when the file at `path` is missing/unreadable or older than `ttl`. An
/// unreadable stat is treated as stale so we err towards refetching.
fn path_is_stale(path: &Path, ttl: Duration) -> bool {
    match std::fs::metadata(path).and_then(|m| m.modified()) {
        Ok(modified) => is_stale(modified, SystemTime::now(), ttl),
        Err(_) => true,
    }
}

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

/// Fetch the catalog JSON text over HTTP, giving up after `CATALOG_FETCH_TIMEOUT`.
/// Errors carry the reqwest message.
pub(crate) async fn fetch_catalog_text(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(CATALOG_FETCH_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
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

/// The catalog copy already on disk, and whether it is due to be replaced.
struct LocalCatalog {
    json: String,
    source: &'static str,
    refresh: bool,
}

/// Read a catalog file, rejecting one that does not parse as JSON. A cache
/// truncated by a crash would otherwise be served in place of the good bundled
/// seed, and the frontend would see an unparseable catalog as an empty one.
fn read_catalog_file(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<serde_json::Value>(&text).ok()?;
    Some(text)
}

/// What the disk can answer with right now: the cache when it is readable and
/// parses, else the bundled seed. `refresh` is set for anything but a within-TTL
/// cache, so a stale, missing or unreadable cache sends us back to the network.
fn read_local_catalog(cache_file: Option<&Path>, seed_file: Option<&Path>) -> Option<LocalCatalog> {
    if let Some(f) = cache_file {
        if let Some(json) = read_catalog_file(f) {
            return Some(LocalCatalog {
                json,
                source: "cache",
                refresh: path_is_stale(f, CATALOG_TTL),
            });
        }
    }
    let json = read_catalog_file(seed_file?)?;
    Some(LocalCatalog {
        json,
        source: "seed",
        refresh: true,
    })
}

/// Fetch the catalog and write it to the disk cache, creating the directory.
async fn refresh_catalog_cache(url: String, cache_file: PathBuf) {
    let Ok(text) = fetch_catalog_text(&url).await else {
        return;
    };
    if let Some(dir) = cache_file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&cache_file, &text);
}

/// Disk → network. Whatever is on disk answers immediately, the cache first and
/// then the bundled seed, and a stale copy is refetched in the background so the
/// next launch gets the newer one. Only a machine with neither a cache nor a seed
/// waits for the network, and that wait is bounded. Never hard-fails: with nothing
/// on disk and no network, the result is an empty catalog with the error attached.
pub(crate) async fn resolve_catalog(
    url: &str,
    cache_file: Option<PathBuf>,
    seed_file: Option<PathBuf>,
) -> CatalogResult {
    if let Some(local) = read_local_catalog(cache_file.as_deref(), seed_file.as_deref()) {
        if local.refresh {
            if let Some(f) = cache_file {
                tauri::async_runtime::spawn(refresh_catalog_cache(url.to_string(), f));
            }
        }
        return CatalogResult {
            json: local.json,
            source: local.source.into(),
            errors: vec![],
        };
    }
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
        Err(e) => CatalogResult {
            json: r#"{"version":1,"entries":[]}"#.into(),
            source: "error".into(),
            errors: vec![e],
        },
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
            // A negative marker only suppresses refetch until it expires, so a
            // temporarily-down host is retried rather than cached as missing forever.
            if neg.exists() && !path_is_stale(neg, NEGATIVE_MARKER_TTL) {
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
    fn is_stale_respects_the_ttl_boundary() {
        let now = SystemTime::now();
        let ttl = Duration::from_secs(3600);
        // written just now -> fresh
        assert!(!is_stale(now, now, ttl));
        // within the window -> fresh
        assert!(!is_stale(now - Duration::from_secs(1800), now, ttl));
        // past the window -> stale
        assert!(is_stale(now - Duration::from_secs(7200), now, ttl));
        // a future mtime (clock skew) counts as fresh, never stale
        assert!(!is_stale(now + Duration::from_secs(60), now, ttl));
    }

    #[test]
    fn path_is_stale_when_file_is_missing() {
        let missing = std::path::Path::new("/no/such/branding/cache/file.none");
        assert!(path_is_stale(missing, Duration::from_secs(3600)));
    }

    /// A fresh empty directory for one catalog test, named after the test.
    fn catalog_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("coilbox-catalog-test-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Backdate a file so `path_is_stale` sees it as past the TTL.
    fn backdate(path: &Path, by: Duration) {
        let f = std::fs::File::options().write(true).open(path).unwrap();
        f.set_modified(SystemTime::now() - by).unwrap();
    }

    #[test]
    fn fresh_cache_answers_and_needs_no_refresh() {
        let dir = catalog_dir("fresh");
        let cache = dir.join("catalog.json");
        std::fs::write(&cache, r#"{"version":1,"entries":[]}"#).unwrap();
        let local = read_local_catalog(Some(&cache), None).unwrap();
        assert_eq!(local.source, "cache");
        assert!(!local.refresh);
    }

    #[test]
    fn stale_cache_still_answers_and_asks_for_a_refresh() {
        let dir = catalog_dir("stale");
        let cache = dir.join("catalog.json");
        std::fs::write(&cache, r#"{"version":1,"entries":[]}"#).unwrap();
        backdate(&cache, CATALOG_TTL + Duration::from_secs(60));
        let local = read_local_catalog(Some(&cache), None).unwrap();
        assert_eq!(local.source, "cache");
        assert!(
            local.refresh,
            "past the TTL the cache answers but refetches"
        );
    }

    #[test]
    fn missing_or_corrupt_cache_falls_through_to_the_seed() {
        let dir = catalog_dir("seed");
        let cache = dir.join("catalog.json");
        let seed = dir.join("seed.json");
        std::fs::write(&seed, r#"{"version":1,"entries":[{"id":"s"}]}"#).unwrap();

        let local = read_local_catalog(Some(&cache), Some(&seed)).unwrap();
        assert_eq!(local.source, "seed");
        assert!(local.refresh);

        // A half-written cache must not shadow the seed.
        std::fs::write(&cache, r#"{"version":1,"entr"#).unwrap();
        let local = read_local_catalog(Some(&cache), Some(&seed)).unwrap();
        assert_eq!(local.source, "seed");
        assert!(local.json.contains("\"s\""));
    }

    #[test]
    fn no_cache_and_no_seed_leaves_the_network_as_the_only_answer() {
        let dir = catalog_dir("empty");
        assert!(read_local_catalog(Some(&dir.join("nope.json")), None).is_none());
        assert!(read_local_catalog(None, None).is_none());
    }

    /// The regression this guards: `resolve_catalog` used to fetch first once the
    /// cache was past its TTL, so a network that black-holes packets held the call
    /// for the OS TCP timeout while a perfectly good catalog sat on disk. 192.0.2.1
    /// is TEST-NET-1 (RFC 5737): routable, assigned to nobody, so the connect hangs
    /// rather than being refused. The answer must not wait on it.
    #[test]
    fn a_black_holed_network_does_not_delay_the_disk_answer() {
        let dir = catalog_dir("blackhole");
        let cache = dir.join("catalog.json");
        std::fs::write(&cache, r#"{"version":1,"entries":[]}"#).unwrap();
        backdate(&cache, CATALOG_TTL + Duration::from_secs(60));

        let started = std::time::Instant::now();
        let res = tauri::async_runtime::block_on(resolve_catalog(
            "http://192.0.2.1/catalog.json",
            Some(cache),
            None,
        ));
        let waited = started.elapsed();

        assert_eq!(res.source, "cache");
        assert!(res.errors.is_empty());
        assert!(
            waited < Duration::from_secs(1),
            "answered from disk in {waited:?}, so it waited on the network"
        );
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
