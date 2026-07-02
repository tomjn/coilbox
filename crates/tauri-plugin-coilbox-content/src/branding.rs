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

/// A cache-dir subpath helper, mirroring the header/thumb cache layout.
pub(crate) fn image_cache_files(cache_dir: &std::path::Path, url: &str) -> (PathBuf, PathBuf) {
    let key = url_key(url);
    (
        cache_dir.join(format!("{key}.dataurl")),
        cache_dir.join(format!("{key}.none")),
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
pub(crate) async fn resolve_image(urls: &[String], cache_dir: Option<PathBuf>) -> Option<String> {
    for url in urls {
        if !url.starts_with("https://") {
            continue;
        }
        let files = cache_dir.as_ref().map(|d| image_cache_files(d, url));
        if let Some((pos, neg)) = &files {
            if let Ok(text) = std::fs::read_to_string(pos) {
                return Some(text);
            }
            if neg.exists() {
                continue;
            }
        }
        match fetch_image(url).await {
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

/// Fetch one image URL → `data:` URL, or `None` on any failure / non-image.
async fn fetch_image(url: &str) -> Option<String> {
    let resp = reqwest::get(url).await.ok()?.error_for_status().ok()?;
    let header = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let content_type = image_content_type(header.as_deref(), url)?;
    let bytes = resp.bytes().await.ok()?;
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
