//! Game-branding catalog + image proxy support.
//!
//! Two concerns live here: fetching/caching the remote `catalog.json`, and
//! fetching remote branding images and caching them once as `data:` URLs (which
//! sidestep CSP host-allowlisting — the catalog can reference any host).

use picoframe_core::CliResult;
use serde_json::json;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager, Runtime};

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

/// How long we wait to reach an image host before giving up. Covers the name
/// lookup, the TCP connect and the TLS handshake. Without it a network that
/// black-holes packets rather than refusing them costs the OS TCP timeout, about
/// 75 seconds, and `resolve_image` pays that per candidate URL.
const IMAGE_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// How long a connected transfer may sit idle before we give up. This is an
/// idle timeout, not a deadline: it resets on every chunk that arrives, so a big
/// banner on a slow link takes as long as it takes and only a stalled transfer is
/// cut off. A whole-request timeout would be wrong here, because clipping a
/// download that was working writes a negative marker saying the picture does not
/// exist, on exactly the connections that need the art most.
const IMAGE_READ_TIMEOUT: Duration = Duration::from_secs(10);

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
/// (aspect-preserving, never upscaled), drop alpha, and re-encode as JPEG bytes.
/// Returns `None` if the bytes aren't a decodable raster (e.g. SVG or WebP) so
/// the caller can fall back to passing the original bytes through. Used only for
/// opaque photographic art, and logos keep their original bytes and transparency.
pub(crate) fn reencode_jpeg(bytes: &[u8]) -> Option<Vec<u8>> {
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
    Some(jpeg)
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
/// v3: the picture is a file the webview loads over `coilbox://contentbranding/`
/// rather than base64 in a `.dataurl` file (#1694).
const IMAGE_CACHE_VERSION: u32 = 3;

/// What a cached picture is: the file it was written to, under a name the asset
/// protocol serves. Its own record because the file's extension comes from the
/// content type the response declared, which a lookup has no other way to know.
#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct CachedImage {
    pub file: String,
}

/// Where one URL's picture is kept: the record naming the picture, and the
/// negative marker for a URL that yielded nothing. The stem carries a version
/// salt and a `photo`/`raw` variant so re-encoded and pass-through results for
/// the same URL never collide (and old entries invalidate).
pub(crate) fn image_cache_files(
    cache_dir: &std::path::Path,
    url: &str,
    reencode: bool,
) -> (PathBuf, PathBuf) {
    let stem = image_cache_stem(url, reencode);
    (
        cache_dir.join(format!("{stem}.json")),
        cache_dir.join(format!("{stem}.none")),
    )
}

/// The stem both the record and the picture are named after.
fn image_cache_stem(url: &str, reencode: bool) -> String {
    let key = url_key(url);
    let variant = if reencode { "photo" } else { "raw" };
    format!("{key}.v{IMAGE_CACHE_VERSION}.{variant}")
}

/// The file extension a picture of `content_type` is stored under, which is also
/// what the asset protocol reads the served content type back off. Anything not
/// recognised is kept as `.bin`, which the protocol serves as a byte stream and
/// an `<img>` sniffs regardless.
fn extension_for(content_type: &str) -> &'static str {
    match content_type {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/bmp" => "bmp",
        _ => "bin",
    }
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

/// Where the bundled seed can sit inside the resource directory, in the order we
/// take them. The Windows installer moves it into `.coilbox\resources` so the
/// install folder shows little more than the executable. Every other platform
/// leaves it at the top of the resource directory. The last two are the layouts
/// older bundles used, and answer for an install that predates this one.
const SEED_CANDIDATES: [&str; 4] = [
    ".coilbox/resources/catalog.json",
    "catalog.json",
    "_up_/catalog.json",
    "branding/catalog.json",
];

/// The bundled seed inside `resource_dir`, or `None` when this install has none.
/// The seed is what makes a cold offline first run answer at all, so a miss here
/// is the one case that waits on the network.
pub(crate) fn seed_file(resource_dir: &Path, exists: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    SEED_CANDIDATES
        .into_iter()
        .map(|rel| resource_dir.join(rel))
        .find(|path| exists(path))
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

/// How a resolved picture reaches the frontend: the cache file name it fetches
/// over `coilbox://contentbranding/`, or the base64 fallback for a picture that
/// had nowhere to go. Only one of the two is ever set.
#[derive(Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolvedImage {
    pub file: Option<String>,
    pub data_url: Option<String>,
}

/// Fetch the first URL that yields an image, cache the bytes as a file, and name
/// it. Positive records and `.none` negative markers avoid refetch. Only `https`
/// URLs are attempted (privacy/security).
pub(crate) async fn resolve_image(
    urls: &[String],
    cache_dir: Option<PathBuf>,
    reencode: bool,
) -> Option<ResolvedImage> {
    for url in urls {
        if !url.starts_with("https://") {
            continue;
        }
        let files = cache_dir
            .as_ref()
            .map(|d| image_cache_files(d, url, reencode));
        if let Some((pos, neg)) = &files {
            // A record naming a picture a cache clean has since removed points
            // at nothing, so it counts as a miss and the URL is fetched again.
            if let Some(hit) = std::fs::read(pos)
                .ok()
                .and_then(|raw| serde_json::from_slice::<CachedImage>(&raw).ok())
                .filter(|hit| pos.with_file_name(&hit.file).is_file())
            {
                return Some(ResolvedImage {
                    file: Some(hit.file),
                    data_url: None,
                });
            }
            // A negative marker only suppresses refetch until it expires, so a
            // temporarily-down host is retried rather than cached as missing forever.
            if neg.exists() && !path_is_stale(neg, NEGATIVE_MARKER_TTL) {
                continue;
            }
        }
        match fetch_image(url, reencode).await {
            Fetched::Image(content_type, bytes) => {
                if let Some((pos, _)) = &files {
                    let name = format!(
                        "{}.{}",
                        image_cache_stem(url, reencode),
                        extension_for(&content_type)
                    );
                    if let Some(dir) = pos.parent() {
                        let _ = std::fs::create_dir_all(dir);
                    }
                    if std::fs::write(pos.with_file_name(&name), &bytes).is_ok() {
                        if let Ok(json) = serde_json::to_vec(&CachedImage { file: name.clone() }) {
                            let _ = std::fs::write(pos, json);
                        }
                        return Some(ResolvedImage {
                            file: Some(name),
                            data_url: None,
                        });
                    }
                }
                return Some(ResolvedImage {
                    file: None,
                    data_url: Some(data_url(&content_type, &bytes)),
                });
            }
            Fetched::Absent => {
                if let Some((_, neg)) = &files {
                    if let Some(dir) = neg.parent() {
                        let _ = std::fs::create_dir_all(dir);
                    }
                    let _ = std::fs::write(neg, b"");
                }
            }
            // No marker. The marker means "the host had nothing for us", and a
            // fetch we gave up on never got that far, so writing one would hide
            // the picture for a day over a network that was down for a minute.
            Fetched::Unreachable => {}
        }
    }
    None
}

/// What one fetch attempt concluded. The two failures are kept apart because only
/// one of them is worth remembering: see the `.none` marker in `resolve_image`.
#[derive(Debug, PartialEq)]
enum Fetched {
    /// The picture, as (content type, bytes).
    Image(String, Vec<u8>),
    /// The host said no: the picture isn't there, or the body it sent isn't an
    /// image. Asking again tomorrow gets the same answer.
    Absent,
    /// No answer about whether the picture exists: no name, no route, a transfer
    /// that stalled, or a host telling us it is having a bad minute.
    Unreachable,
}

/// What a status the host answered with says about the picture. Only a refusal is
/// the host saying no: the picture isn't there (404, 410), or isn't ours to have
/// (403). Everything else it can answer with is "not right now" - 429 asking us to
/// slow down, a 502 or 503 from an origin or a CDN that is broken - and that says
/// nothing about whether the picture exists. Remembering one of those as missing
/// costs a day of card art over a minute of somebody else's downtime.
fn outcome_for_status(status: reqwest::StatusCode) -> Fetched {
    match status {
        reqwest::StatusCode::NOT_FOUND
        | reqwest::StatusCode::GONE
        | reqwest::StatusCode::FORBIDDEN => Fetched::Absent,
        _ => Fetched::Unreachable,
    }
}

/// Fetch one image URL. When `reencode` is set the bytes are downsampled and
/// JPEG-encoded (for opaque photographic art). Bytes that can't be decoded
/// (SVG/WebP) pass through raw.
async fn fetch_image(url: &str, reencode: bool) -> Fetched {
    let client = match reqwest::Client::builder()
        .connect_timeout(IMAGE_CONNECT_TIMEOUT)
        .read_timeout(IMAGE_READ_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(_) => return Fetched::Unreachable,
    };
    let resp = match client.get(url).send().await {
        Ok(resp) => resp,
        Err(_) => return Fetched::Unreachable,
    };
    if !resp.status().is_success() {
        return outcome_for_status(resp.status());
    }
    let header = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let Some(content_type) = image_content_type(header.as_deref(), url) else {
        return Fetched::Absent;
    };
    let Ok(bytes) = resp.bytes().await else {
        return Fetched::Unreachable;
    };
    if reencode {
        if let Some(jpeg) = reencode_jpeg(&bytes) {
            return Fetched::Image("image/jpeg".to_string(), jpeg);
        }
    }
    Fetched::Image(content_type, bytes.to_vec())
}

/// `branding_catalog`, answer with the branding catalog JSON already on disk (the
/// cache, else the bundled seed), refetching in the background when that copy is
/// past its TTL. Returns the raw JSON text. The frontend parses and matches it, so
/// Rust stays schema-agnostic.
#[tauri::command]
pub(crate) async fn branding_catalog<R: Runtime>(app: AppHandle<R>, url: String) -> CliResult {
    let cache_file = coilbox_portable::cache_dir(&app)
        .ok()
        .map(|d| d.join("coilbox-branding").join("catalog.json"));
    let seed_file = app
        .path()
        .resource_dir()
        .ok()
        .and_then(|d| seed_file(&d, |p| p.exists()));
    let res = resolve_catalog(&url, cache_file, seed_file).await;
    CliResult::ok(json!(res))
}

/// `branding_image` fetches the first working image URL (https only), caches the
/// bytes as a file keyed by URL hash, and names it. Neither field set means the
/// UI falls back to the game's own art or gradient. When `reencode` is set, for
/// opaque photographic art like banners and screenshots, decodable rasters are
/// downsampled and JPEG-encoded to bound what is kept, and logos pass through
/// untouched.
///
/// The picture comes back as `file`, a name under `coilbox://contentbranding/`,
/// with `dataUrl` holding the bytes only where there was nowhere to cache them.
#[tauri::command]
pub(crate) async fn branding_image<R: Runtime>(
    app: AppHandle<R>,
    urls: Vec<String>,
    reencode: bool,
) -> CliResult {
    let resolved = resolve_image(&urls, branding_image_dir(&app), reencode).await;
    CliResult::ok(json!(resolved.unwrap_or_default()))
}

/// Subdirectory of the app cache dir holding catalog art fetched over the
/// network. `None` when the platform can't resolve a cache dir, and the pictures
/// are then not cached at all.
const BRANDING_IMAGE_SUBDIR: &str = "coilbox-branding-images";

/// Where catalog art is cached. Public because the asset protocol serves this
/// folder as its `contentbranding` root.
pub fn branding_image_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    coilbox_portable::cache_dir(app)
        .ok()
        .map(|d| d.join(BRANDING_IMAGE_SUBDIR))
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
    fn the_seed_is_found_where_the_windows_installer_tucks_it() {
        let res = Path::new("C:/Program Files/Coilbox");
        let tucked = res.join(".coilbox/resources/catalog.json");
        assert_eq!(seed_file(res, |path| path == tucked), Some(tucked));
    }

    #[test]
    fn an_install_that_kept_its_old_seed_layout_still_answers() {
        let res = Path::new("/app/resources");
        let old = res.join("branding/catalog.json");
        assert_eq!(seed_file(res, |path| path == old), Some(old));
    }

    #[test]
    fn a_build_with_no_seed_says_so() {
        assert_eq!(seed_file(Path::new("/app"), |_| false), None);
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
        let jpeg = reencode_jpeg(&png_bytes(3840, 2160)).unwrap();
        assert_eq!(&jpeg[..2], b"\xff\xd8");
        let out = image::load_from_memory(&jpeg).unwrap();
        assert!(out.width() <= PHOTO_MAX_W && out.height() <= PHOTO_MAX_H);
        assert_eq!(out.width(), PHOTO_MAX_W); // 16:9 source hits the width bound
    }

    #[test]
    fn reencode_keeps_small_images_unscaled() {
        let jpeg = reencode_jpeg(&png_bytes(320, 200)).unwrap();
        let out = image::load_from_memory(&jpeg).unwrap();
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
        // The record is JSON and names the picture beside it, which is what
        // replaced the base64 the cache used to hold (#1694).
        assert!(photo.to_string_lossy().ends_with(".json"));
    }

    /// A picture is stored under the extension its content type implies, so the
    /// asset protocol serves it back as the type it is.
    #[test]
    fn a_picture_is_named_after_its_content_type() {
        assert_eq!(extension_for("image/png"), "png");
        assert_eq!(extension_for("image/svg+xml"), "svg");
        assert_eq!(extension_for("image/jpeg"), "jpg");
        // Nothing recognised still gets a name, and an `<img>` sniffs it.
        assert_eq!(extension_for("image/avif"), "bin");
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

    /// A fresh empty image cache directory for one test, named after the test.
    fn image_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("coilbox-image-test-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A port on the loopback that nothing is listening on, so a connect to it is
    /// refused straight away.
    fn closed_port() -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    }

    /// Which statuses are the host saying the picture is not there, and which are
    /// it having a bad minute. Only the first kind is remembered, because a `.none`
    /// marker hides the picture for 24 hours: a CDN answering 503 for one minute
    /// costing a day of card art is the same bug as a timeout costing a day of it.
    #[test]
    fn only_a_refusal_means_the_picture_is_not_there() {
        for refusal in [
            reqwest::StatusCode::NOT_FOUND,
            reqwest::StatusCode::GONE,
            reqwest::StatusCode::FORBIDDEN,
        ] {
            assert_eq!(
                outcome_for_status(refusal),
                Fetched::Absent,
                "{refusal} is the host saying no, and is worth remembering"
            );
        }
        for later in [
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            reqwest::StatusCode::BAD_GATEWAY,
            reqwest::StatusCode::SERVICE_UNAVAILABLE,
            reqwest::StatusCode::GATEWAY_TIMEOUT,
        ] {
            assert_eq!(
                outcome_for_status(later),
                Fetched::Unreachable,
                "{later} is the host saying not right now, so ask again next launch"
            );
        }
    }

    /// The poisoning this guards: a host we never heard back from must not leave a
    /// `.none` marker, because that marker means "the host had nothing for us" and
    /// suppresses a refetch for 24 hours. Somebody who was offline for a minute
    /// would lose their card art for a day.
    #[test]
    fn a_host_we_could_not_reach_leaves_no_negative_marker() {
        let dir = image_dir("unreachable");
        let url = format!("https://127.0.0.1:{}/banner.png", closed_port());
        let (pos, neg) = image_cache_files(&dir, &url, false);

        let res = tauri::async_runtime::block_on(resolve_image(
            std::slice::from_ref(&url),
            Some(dir.clone()),
            false,
        ));

        assert!(res.is_none());
        assert!(
            !neg.exists(),
            "a refused connection wrote a negative marker"
        );
        assert!(!pos.exists());
    }

    /// The other half: a marker that has been written does still suppress the
    /// refetch. 192.0.2.1 is TEST-NET-1 (RFC 5737), routable and assigned to
    /// nobody, so reaching it costs the connect timeout. The answer must come back
    /// long before that, which it only can if the marker was honoured.
    #[test]
    fn a_fresh_negative_marker_still_suppresses_the_refetch() {
        let dir = image_dir("marker");
        let url = "https://192.0.2.1/banner.png".to_string();
        let (_, neg) = image_cache_files(&dir, &url, false);
        std::fs::write(&neg, b"").unwrap();

        let started = std::time::Instant::now();
        let res = tauri::async_runtime::block_on(resolve_image(
            std::slice::from_ref(&url),
            Some(dir),
            false,
        ));
        let waited = started.elapsed();

        assert!(res.is_none());
        assert!(
            waited < Duration::from_secs(1),
            "answered in {waited:?}, so it went to the network anyway"
        );
    }

    /// And the wait itself is bounded. Without a connect timeout a black-holed
    /// host costs the OS TCP timeout, about 75 seconds, per candidate URL.
    #[test]
    fn a_black_holed_image_host_gives_up_on_the_connect() {
        let dir = image_dir("blackhole");
        let url = "https://192.0.2.1/banner.png".to_string();

        let started = std::time::Instant::now();
        let res = tauri::async_runtime::block_on(resolve_image(
            std::slice::from_ref(&url),
            Some(dir),
            false,
        ));
        let waited = started.elapsed();

        assert!(res.is_none());
        assert!(
            waited < IMAGE_CONNECT_TIMEOUT + Duration::from_secs(5),
            "waited {waited:?}, so the connect is not bounded"
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
