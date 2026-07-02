//! Game-branding catalog + image proxy support.
//!
//! Two concerns live here: fetching/caching the remote `catalog.json`, and
//! fetching remote branding images and caching them once as `data:` URLs (which
//! sidestep CSP host-allowlisting — the catalog can reference any host).

// removed in Task 2 (helpers consumed by fetch/cache + Tauri commands there).
#![allow(dead_code)]

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
