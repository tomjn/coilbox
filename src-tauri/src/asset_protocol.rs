//! The `coilbox://` asset protocol: streams local files straight to the webview so
//! a distribution can reference images/audio/video/fonts by path instead of inlining
//! them as base64 `data:` URIs. Data URIs are fine for small images but ruinous for
//! audio/video — a large clip would be held in JS memory with no range/seek support.
//! This scheme range-serves the bytes, so `<video>` scrubbing works.
//!
//! It is **multi-root**: the first path segment selects the root, the rest is the
//! file path. Keeping the selector in the path (not the URI host) means it survives
//! the Windows rewrite where custom schemes arrive as `http://coilbox.localhost/...`.
//!
//!   - `coilbox://localhost/portable/<path>`      → `<portable_root>/<path>`
//!     (profile welcome assets + bundled campaigns; only present in portable mode)
//!   - `coilbox://localhost/campaign/<id>/<file>` → `<data_dir>/campaign/media/<id>/<file>`
//!     (user-authored campaign AV; `data_dir` is the OS app-data dir on a normal
//!     install, so this works with no `.coilbox` folder)
//!   - `coilbox://localhost/scenario/<id>/<file>` → `<data_dir>/scenario/media/<id>/<file>`
//!     (a scenario's dialogue portraits and voice clips, so the editor can show a
//!     portrait and play a clip without holding the whole file base64 in JS)
//!   - `coilbox://localhost/legopack/<file>`      → `.coilbox/legoparts/<file>` if
//!     present, else `<resource_dir>/legoparts/<file>` (the unit builder's base
//!     parts pack, portable-first so a distribution can ship its own)
//!   - `coilbox://localhost/legopacks/<name>/<file>` → `<data_dir>/lego/packs/<name>/<file>`
//!     (extension parts packs, which add parts to the base pack's atlas)
//!   - `coilbox://localhost/lego/<file>`      → `<data_dir>/lego/thumbs/<file>`
//!   - `coilbox://localhost/legogeom/<file>`  → `<data_dir>/lego/geometry/<file>`
//!     (the meshes of a unit imported from somebody else's `.s3o`)
//!   - `coilbox://localhost/legotex/<file>`   → `<data_dir>/lego/textures/<file>`
//!     (the textures those units draw with, keyed by content)
//!
//! Every segment is percent-decoded and rejected if it contains path syntax, so a
//! request can never escape its root. Any miss (no root, unsafe path, absent file)
//! returns 404 rather than leaking why.
//!
//! Note: CSP is `null` today, so the scheme loads unrestricted. If CSP is ever
//! enabled it must allowlist `coilbox:` (and the Windows `http://coilbox.localhost`
//! form) under `img-src`, `media-src` and `font-src`.

use std::borrow::Cow;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Runtime};

/// Percent-decode a single path segment (`%20` → space, etc.). Returns `None` on a
/// malformed escape or non-UTF-8 result. Deliberately does NOT treat `+` as space —
/// path components use `+` literally (only query strings use `+`).
fn percent_decode(seg: &str) -> Option<String> {
    let b = seg.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hi = (*b.get(i + 1)? as char).to_digit(16)?;
            let lo = (*b.get(i + 2)? as char).to_digit(16)?;
            out.push((hi * 16 + lo) as u8);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Split a URI path (`/portable/images/my%20art.jpg`) into decoded, safe segments.
/// Empty pieces are skipped; a segment that decodes to `.`/`..` or still contains a
/// separator is rejected outright (returns `None`), so the result can never escape a
/// root when joined.
fn safe_segments(path: &str) -> Option<Vec<String>> {
    let mut out = Vec::new();
    for raw in path.split('/') {
        if raw.is_empty() {
            continue;
        }
        let dec = percent_decode(raw)?;
        if dec == "." || dec == ".." || dec.contains('/') || dec.contains('\\') || dec.is_empty() {
            return None;
        }
        out.push(dec);
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Resolve decoded segments to an on-disk path under the selected root, or `None` if
/// the root is unavailable / the shape is wrong. The bases are injected so this is
/// unit-testable without the real filesystem or app handle. `data_dir` covers every
/// root that lives under the app-data dir (campaign, scenario, and the three lego
/// folders), the plugin-owned ones take their own closure.
fn resolve_path(
    segments: &[String],
    portable: Option<PathBuf>,
    data_dir: impl FnOnce() -> Option<PathBuf>,
    legopack_base: impl FnOnce() -> Option<PathBuf>,
    extra_packs_base: impl FnOnce() -> Option<PathBuf>,
    unit_model_base: impl FnOnce() -> Option<PathBuf>,
) -> Option<PathBuf> {
    let (root, rest) = segments.split_first()?;
    match root.as_str() {
        "portable" => {
            if rest.is_empty() {
                return None;
            }
            Some(rest.iter().fold(portable?, |p, s| p.join(s)))
        }
        // Both keep their per-owner media in `<data_dir>/<root>/media/<id>/`, so
        // both are `<root>/<id>/<file...>` with the id charset-guarded and at
        // least one file segment.
        "campaign" | "scenario" => {
            let (id, file) = rest.split_first()?;
            if !coilbox_portable::valid_id(id) || file.is_empty() {
                return None;
            }
            let base = data_dir()?.join(root).join("media").join(id);
            Some(file.iter().fold(base, |p, s| p.join(s)))
        }
        "legopack" => {
            // legopack/<file...>: the unit builder's base parts pack.
            if rest.is_empty() {
                return None;
            }
            Some(rest.iter().fold(legopack_base()?, |p, s| p.join(s)))
        }
        "legopacks" => {
            // legopacks/<name>/<file...>: one installed extension pack.
            let (name, file) = rest.split_first()?;
            if file.is_empty() {
                return None;
            }
            let base = extra_packs_base()?.join(name);
            Some(file.iter().fold(base, |p, s| p.join(s)))
        }
        // The unit builder's three flat folders under `<data_dir>/lego`, each
        // its own root so a request for one can never reach another: thumbnails,
        // an imported unit's geometry, and the textures those units draw with.
        "lego" | "legogeom" | "legotex" => {
            let folder = match root.as_str() {
                "legogeom" => "geometry",
                "legotex" => "textures",
                _ => "thumbs",
            };
            let [file] = rest else {
                return None;
            };
            Some(data_dir()?.join("lego").join(folder).join(file))
        }
        "unitmodel" => {
            // unitmodel/<file>: textures copied out of a game archive for the
            // unit-model viewer, one flat folder. Raw archive bytes rather than
            // anything decoded, because the shared atlases are compressed DDS
            // measured in tens of megabytes and the webview uploads them as-is.
            let [file] = rest else {
                return None;
            };
            Some(unit_model_base()?.join(file))
        }
        _ => None,
    }
}

/// Parse a single-range `Range: bytes=…` header against a known length, returning the
/// inclusive `(start, end)` to serve. `None` (serve the whole file) for an absent,
/// malformed, multi-range, or unsatisfiable header — the caller then returns 200.
fn parse_range(header: Option<&str>, len: u64) -> Option<(u64, u64)> {
    let spec = header?.strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None; // multi-range unsupported → fall back to full body
    }
    let (a, b) = spec.split_once('-')?;
    let (start, end) = if a.is_empty() {
        // suffix range: the last N bytes
        let n: u64 = b.parse().ok()?;
        if n == 0 {
            return None;
        }
        let n = n.min(len);
        (len - n, len - 1)
    } else {
        let start: u64 = a.parse().ok()?;
        let end = if b.is_empty() {
            len.checked_sub(1)?
        } else {
            b.parse::<u64>().ok()?.min(len.saturating_sub(1))
        };
        (start, end)
    };
    if len == 0 || start > end || start >= len {
        return None;
    }
    Some((start, end))
}

fn not_found() -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Cow::Owned(Vec::new()))
        .expect("static 404 response is valid")
}

/// Build the file response for `full`, honouring a `Range` request with a 206 that
/// reads only the requested window (so large video never loads fully into memory).
///
/// Responses carry `Access-Control-Allow-Origin: *`, which the `<img>` and
/// `<video>` uses never needed but `fetch()` does. Without it WKWebView rejects
/// a custom-scheme fetch before it ever reaches a status code. The scheme only
/// ever serves files under its own roots, and the webview is its only client.
fn serve_file(full: &PathBuf, range: Option<&str>) -> Response<Cow<'static, [u8]>> {
    let Ok(meta) = std::fs::metadata(full) else {
        return not_found();
    };
    if !meta.is_file() {
        return not_found();
    }
    let len = meta.len();
    let mime = coilbox_portable::mime_for(full);

    match parse_range(range, len) {
        Some((start, end)) => {
            let count = end - start + 1;
            let mut buf = vec![0u8; count as usize];
            let read = File::open(full)
                .and_then(|mut f| {
                    f.seek(SeekFrom::Start(start))?;
                    f.read_exact(&mut buf)?;
                    Ok(())
                })
                .is_ok();
            if !read {
                return not_found();
            }
            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, mime)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
                .header(header::CONTENT_LENGTH, count.to_string())
                .header(header::CACHE_CONTROL, "no-cache")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(Cow::Owned(buf))
                .expect("range response builder inputs are valid")
        }
        None => match std::fs::read(full) {
            Ok(bytes) => Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, len.to_string())
                .header(header::CACHE_CONTROL, "no-cache")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(Cow::Owned(bytes))
                .expect("full response builder inputs are valid"),
            Err(_) => not_found(),
        },
    }
}

/// Handle one `coilbox://` request: resolve the root + path, then stream the file
/// (with range support). Blocking file IO — the registration runs this off-thread.
pub fn handle<R: Runtime>(
    app: &AppHandle<R>,
    request: &Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let Some(segments) = safe_segments(request.uri().path()) else {
        return not_found();
    };
    let full = resolve_path(
        &segments,
        coilbox_portable::portable_root(),
        || coilbox_portable::data_dir(app).ok(),
        || tauri_plugin_coilbox_lego::legopack_dir(app),
        || tauri_plugin_coilbox_lego::extra_packs_dir(app),
        || tauri_plugin_coilbox_unitsync::model_texture_dir(app),
    );
    let Some(full) = full else {
        return not_found();
    };
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok());
    serve_file(&full, range)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_decode_handles_escapes() {
        assert_eq!(
            percent_decode("my%20art.jpg").as_deref(),
            Some("my art.jpg")
        );
        assert_eq!(percent_decode("plain").as_deref(), Some("plain"));
        assert_eq!(percent_decode("a+b").as_deref(), Some("a+b")); // + is literal
        assert_eq!(percent_decode("bad%2"), None);
    }

    #[test]
    fn safe_segments_rejects_traversal() {
        assert_eq!(
            safe_segments("/portable/images/x.jpg"),
            Some(vec!["portable".into(), "images".into(), "x.jpg".into()])
        );
        assert_eq!(safe_segments("/portable/../etc"), None);
        assert_eq!(safe_segments("/"), None);
        assert_eq!(safe_segments(""), None);
    }

    /// The app-data roots under one `data_dir`, which is how the real handler
    /// injects them.
    fn under_data(segments: &[String]) -> Option<PathBuf> {
        resolve_path(
            segments,
            None,
            || Some(PathBuf::from("/data")),
            || None,
            || None,
            || None,
        )
    }

    fn segs(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn resolve_portable_joins_under_root() {
        let s = segs(&["portable", "images", "x.jpg"]);
        let got = resolve_path(
            &s,
            Some(PathBuf::from("/pkg/.coilbox")),
            || None,
            || None,
            || None,
            || None,
        );
        assert_eq!(got, Some(PathBuf::from("/pkg/.coilbox/images/x.jpg")));
    }

    #[test]
    fn resolve_portable_none_without_root() {
        let s = segs(&["portable", "x.jpg"]);
        assert_eq!(
            resolve_path(&s, None, || None, || None, || None, || None),
            None
        );
    }

    #[test]
    fn resolve_campaign_guards_id_and_shape() {
        assert_eq!(
            under_data(&segs(&["campaign", "camp-1", "intro.mp4"])),
            Some(PathBuf::from("/data/campaign/media/camp-1/intro.mp4"))
        );
        // missing file segment
        assert_eq!(under_data(&segs(&["campaign", "camp-1"])), None);
        // bad id
        assert_eq!(under_data(&segs(&["campaign", "../x", "intro.mp4"])), None);
    }

    #[test]
    fn resolve_scenario_serves_dialogue_media_per_scenario() {
        assert_eq!(
            under_data(&segs(&["scenario", "sc-1", "abc.ogg"])),
            Some(PathBuf::from("/data/scenario/media/sc-1/abc.ogg"))
        );
        // missing file segment
        assert_eq!(under_data(&segs(&["scenario", "sc-1"])), None);
        // bad id
        assert_eq!(under_data(&segs(&["scenario", "../x", "abc.ogg"])), None);
        // and nothing resolves without an app-data dir
        let s = segs(&["scenario", "sc-1", "abc.ogg"]);
        assert_eq!(
            resolve_path(&s, None, || None, || None, || None, || None),
            None
        );
    }

    #[test]
    fn resolve_legopack_joins_under_its_base() {
        let base = || Some(PathBuf::from("/res/legoparts"));
        let s = segs(&["legopack", "parts.bin.gz"]);
        assert_eq!(
            resolve_path(&s, None, || None, base, || None, || None),
            Some(PathBuf::from("/res/legoparts/parts.bin.gz"))
        );
        // no file segment, and no pack installed
        let bare = segs(&["legopack"]);
        assert_eq!(
            resolve_path(&bare, None, || None, base, || None, || None),
            None
        );
        assert_eq!(
            resolve_path(&s, None, || None, || None, || None, || None),
            None
        );
    }

    #[test]
    fn resolve_lego_serves_one_flat_folder_per_root() {
        assert_eq!(
            under_data(&segs(&["lego", "abc.png"])),
            Some(PathBuf::from("/data/lego/thumbs/abc.png"))
        );
        assert_eq!(
            under_data(&segs(&["legogeom", "abc.bin.gz"])),
            Some(PathBuf::from("/data/lego/geometry/abc.bin.gz"))
        );
        assert_eq!(
            under_data(&segs(&["legotex", "ff00.dds"])),
            Some(PathBuf::from("/data/lego/textures/ff00.dds"))
        );
        // None of the three is nested, so a deeper path is not one of its files.
        assert_eq!(under_data(&segs(&["lego", "sub", "abc.png"])), None);
    }

    #[test]
    fn resolve_unknown_root_is_none() {
        let s = segs(&["secret", "x"]);
        assert_eq!(
            resolve_path(
                &s,
                Some(PathBuf::from("/pkg")),
                || Some(PathBuf::from("/data")),
                || None,
                || None,
                || None
            ),
            None
        );
    }

    #[test]
    fn resolve_unitmodel_serves_one_flat_folder() {
        let base = || Some(PathBuf::from("/cache/model-textures"));
        let s = segs(&["unitmodel", "abc_atlas_dds.dds"]);
        assert_eq!(
            resolve_path(&s, None, || None, || None, || None, base),
            Some(PathBuf::from("/cache/model-textures/abc_atlas_dds.dds"))
        );
        // The cache is flat, so a nested path is not one of its files.
        let nested = segs(&["unitmodel", "sub", "abc.dds"]);
        assert_eq!(
            resolve_path(&nested, None, || None, || None, || None, base),
            None
        );
    }

    #[test]
    fn parse_range_variants() {
        assert_eq!(parse_range(Some("bytes=0-99"), 1000), Some((0, 99)));
        assert_eq!(parse_range(Some("bytes=100-"), 1000), Some((100, 999)));
        assert_eq!(parse_range(Some("bytes=-100"), 1000), Some((900, 999)));
        assert_eq!(parse_range(Some("bytes=990-5000"), 1000), Some((990, 999)));
        assert_eq!(parse_range(None, 1000), None);
        assert_eq!(parse_range(Some("bytes=0-0,5-6"), 1000), None); // multi-range
        assert_eq!(parse_range(Some("bytes=2000-3000"), 1000), None); // unsatisfiable
    }
}
