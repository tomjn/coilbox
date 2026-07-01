//! Archive browsing: list an archive's members (`tree`) and read a single member
//! for preview (`file`). Both go through unitsync's VFS (`OpenArchive` +
//! `FindFilesArchive`/`ReadArchiveFile`), so `.sd7`/`.sdz`/`.sdd` and rapid-pool
//! `.sdp` packages are read uniformly — each in its own one-shot `Init` session.

use crate::ffi::Unitsync;
use crate::model::{ArchiveExtractOutput, ArchiveFileEntry, ArchiveFileOutput, ArchiveTreeOutput};
use base64::Engine;
use std::path::Path;

/// Text members are previewed up to 512 KiB; larger ones report as too large.
const TEXT_CAP: usize = 512 * 1024;
/// Image members are previewed up to 8 MiB.
const IMAGE_CAP: usize = 8 * 1024 * 1024;

/// List every member of `archive` as `(path, size)`, plus its on-disk path.
pub fn tree(lib: &str, archive_name: &str) -> ArchiveTreeOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return ArchiveTreeOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let mut errors = us.drain_errors();

    let open_path = resolve_open_path(&us, archive_name);
    // Resolution may probe several candidate archives; discard their diagnostics.
    let _ = us.drain_errors();
    let archive_path = open_path
        .as_deref()
        .and_then(|p| absolute_archive_path(&us, p));

    let files = match open_path.as_deref().and_then(|p| us.open_archive(p)) {
        Some(handle) => {
            let mut files: Vec<ArchiveFileEntry> = us
                .list_archive_files(handle)
                .into_iter()
                .map(|(path, size)| ArchiveFileEntry { path, size })
                .collect();
            us.close_archive(handle);
            files.sort_by(|a, b| a.path.cmp(&b.path));
            files
        }
        None => {
            errors.push(format!("could not open archive {archive_name}"));
            Vec::new()
        }
    };

    // A zero CRC means "unknown" here, so omit it rather than show a misleading 0.
    let checksum = us
        .archive_checksum(archive_name)
        .filter(|&c| c != 0)
        .map(|c| format!("{c:08x}"));

    errors.extend(us.drain_errors());
    us.uninit();

    ArchiveTreeOutput {
        files,
        archive_path,
        checksum,
        errors,
    }
}

/// Resolve an archive's scan-reported `name` to a path `OpenArchive` accepts.
///
/// `OpenArchive` takes a VFS path/filename, not a name — and `GetArchivePath`
/// only resolves filename-form names. Games' primary archives are reported by
/// filename, so they resolve directly. Maps are reported by a *versioned display
/// name* (`GetMapArchiveName` returns `GetNameVersioned()`, e.g.
/// "AcidicQuarry 5.17"), which neither call can turn into a path. For those we
/// match the name to a map, take its `.smf` file as a signature, and find the
/// backing archive among the raw map archives — the only unitsync-API route from
/// a versioned name to an openable file. (Display-name *dependencies* that are
/// neither a map nor a filename, e.g. "Map Helper v1", stay unresolved.)
fn resolve_open_path(us: &Unitsync, name: &str) -> Option<String> {
    if let Some(dir) = us.archive_path(name) {
        return Some(Path::new(&dir).join(name).to_string_lossy().into_owned());
    }
    let smf = (0..us.map_count())
        .find(|&i| us.map_name(i).as_deref() == Some(name))
        .and_then(|i| us.map_file_name(i))?;
    us.list_vfs_dir("maps", "*", "r")
        .into_iter()
        .filter(|c| is_archive_file(c))
        .find(|cand| match us.open_archive(cand) {
            Some(h) => {
                let hit = us.list_archive_files(h).iter().any(|(p, _)| *p == smf);
                us.close_archive(h);
                hit
            }
            None => false,
        })
}

/// Whether a VFS path looks like a map/game archive we can open (skips stray
/// files like `.DS_Store` that the raw listing also returns).
fn is_archive_file(path: &str) -> bool {
    let lower = path.to_lowercase();
    [".sd7", ".sdz", ".sdd", ".sdp"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

/// The absolute on-disk path for an openable archive path (which may be VFS-
/// relative, like `maps/foo.sd7`, or already absolute).
fn absolute_archive_path(us: &Unitsync, open_path: &str) -> Option<String> {
    let fname = Path::new(open_path)
        .file_name()?
        .to_string_lossy()
        .into_owned();
    let dir = us.archive_path(&fname)?;
    Some(Path::new(&dir).join(&fname).to_string_lossy().into_owned())
}

/// Read one member of `archive` for preview, classifying it by extension.
pub fn file(lib: &str, archive_name: &str, inner: &str) -> ArchiveFileOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return ArchiveFileOutput {
                kind: "binary".into(),
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let mut errors = us.drain_errors();

    let open_path = resolve_open_path(&us, archive_name);
    // Resolution may probe several candidate archives; discard their diagnostics.
    let _ = us.drain_errors();
    let handle = open_path.and_then(|p| us.open_archive(&p));
    let out = match handle {
        Some(handle) => {
            let result = read_member(&us, handle, inner);
            us.close_archive(handle);
            result
        }
        None => {
            errors.push(format!("could not open archive {archive_name}"));
            ArchiveFileOutput {
                kind: "binary".into(),
                ..Default::default()
            }
        }
    };

    errors.extend(us.drain_errors());
    us.uninit();

    ArchiveFileOutput { errors, ..out }
}

/// Classify by extension, read up to the matching cap, and build the output.
fn read_member(us: &Unitsync, handle: i32, inner: &str) -> ArchiveFileOutput {
    let ext = inner
        .rsplit('.')
        .next()
        .filter(|e| !e.eq_ignore_ascii_case(inner)) // no extension
        .unwrap_or("")
        .to_lowercase();
    let (kind, cap) = classify(&ext);

    let Some((size, bytes)) = us.read_archive_member(handle, inner, cap) else {
        return ArchiveFileOutput {
            kind: "binary".into(),
            errors: vec![format!("could not read member {inner}")],
            ..Default::default()
        };
    };
    let oversize = size as usize > cap;

    match kind {
        Kind::Text if !oversize => ArchiveFileOutput {
            kind: "text".into(),
            text: Some(String::from_utf8_lossy(&bytes).into_owned()),
            size,
            truncated: false,
            ..Default::default()
        },
        // An image we can present to the browser: native formats pass through,
        // `.tga` is transcoded. A decode failure may mean the file isn't really an
        // image (e.g. a texture that's actually a mis-downloaded HTML page), so
        // fall back to a text preview when the bytes are UTF-8; else binary.
        Kind::Image if !oversize => match encode_preview_image(&ext, &bytes) {
            Some(data_url) => ArchiveFileOutput {
                kind: "image".into(),
                data_url: Some(data_url),
                size,
                truncated: false,
                ..Default::default()
            },
            None => text_fallback(&bytes, size).unwrap_or(ArchiveFileOutput {
                kind: "binary".into(),
                size,
                truncated: false,
                ..Default::default()
            }),
        },
        // Binary members, or previewable types that exceeded their cap.
        _ => ArchiveFileOutput {
            kind: "binary".into(),
            size,
            truncated: !matches!(kind, Kind::Binary) && oversize,
            ..Default::default()
        },
    }
}

enum Kind {
    Text,
    Image,
    Binary,
}

/// Map an extension to a preview kind and its byte cap. `.tga` is decoded to PNG
/// for preview; other formats browsers can't render (`.dds`, ...) fall through to
/// binary.
fn classify(ext: &str) -> (Kind, usize) {
    const TEXT: &[&str] = &[
        "lua", "txt", "cfg", "json", "xml", "ini", "md", "glsl", "h", "tdf", "smd", "fbi", "gui",
        "bos", "yml", "yaml", "csv", "html", "css", "js",
    ];
    const IMAGE: &[&str] = &["png", "jpg", "jpeg", "gif", "bmp", "tga"];
    if TEXT.contains(&ext) {
        (Kind::Text, TEXT_CAP)
    } else if IMAGE.contains(&ext) {
        (Kind::Image, IMAGE_CAP)
    } else {
        (Kind::Binary, 0)
    }
}

/// Reinterpret an undecodable "image" as text when its bytes are valid UTF-8 and
/// within the text cap. Catches assets mislabelled with an image extension (e.g.
/// an HTML error page saved as `.tga`).
fn text_fallback(bytes: &[u8], size: u64) -> Option<ArchiveFileOutput> {
    if size > TEXT_CAP as u64 {
        return None;
    }
    let text = std::str::from_utf8(bytes).ok()?;
    Some(ArchiveFileOutput {
        kind: "text".into(),
        text: Some(text.to_owned()),
        size,
        truncated: false,
        ..Default::default()
    })
}

/// Build a `data:` URL for an image member, or `None` if it can't be rendered.
/// Browser-native formats pass through as-is; `.tga` is decoded and re-encoded to
/// PNG (browsers don't render TGA). Returns `None` if a TGA fails to decode.
fn encode_preview_image(ext: &str, bytes: &[u8]) -> Option<String> {
    let (mime, payload) = match ext {
        "png" => ("image/png", bytes.to_vec()),
        "jpg" | "jpeg" => ("image/jpeg", bytes.to_vec()),
        "gif" => ("image/gif", bytes.to_vec()),
        "bmp" => ("image/bmp", bytes.to_vec()),
        "tga" => ("image/png", tga_to_png(bytes)?),
        _ => return None,
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&payload);
    Some(format!("data:{mime};base64,{b64}"))
}

/// Decode TGA bytes and re-encode them as PNG. The alpha channel is dropped:
/// Spring's unit/map textures use it as a data channel (team-colour mask,
/// specular, ...) rather than transparency, so an alpha-aware preview renders
/// many of them fully transparent. Flattening to opaque RGB keeps the colour
/// content visible.
fn tga_to_png(bytes: &[u8]) -> Option<Vec<u8>> {
    let img = image::load_from_memory_with_format(bytes, image::ImageFormat::Tga).ok()?;
    let rgb = image::DynamicImage::ImageRgb8(img.to_rgb8());
    let mut png = std::io::Cursor::new(Vec::new());
    rgb.write_to(&mut png, image::ImageFormat::Png).ok()?;
    Some(png.into_inner())
}

/// Read one member of `archive` in full and write its raw bytes to `dest` (used by
/// the download action). Unlike preview, this is uncapped and never transcodes.
pub fn extract(lib: &str, archive_name: &str, inner: &str, dest: &str) -> ArchiveExtractOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return ArchiveExtractOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let mut errors = us.drain_errors();

    let open_path = resolve_open_path(&us, archive_name);
    // Resolution may probe several candidate archives; discard their diagnostics.
    let _ = us.drain_errors();
    let handle = open_path.and_then(|p| us.open_archive(&p));
    let mut size = 0;
    match handle {
        Some(handle) => {
            match us.read_archive_member(handle, inner, usize::MAX) {
                Some((real, bytes)) => match std::fs::write(dest, &bytes) {
                    Ok(()) => size = real,
                    Err(e) => errors.push(format!("could not write {dest}: {e}")),
                },
                None => errors.push(format!("could not read member {inner}")),
            }
            us.close_archive(handle);
        }
        None => errors.push(format!("could not open archive {archive_name}")),
    }

    errors.extend(us.drain_errors());
    us.uninit();

    ArchiveExtractOutput { size, errors }
}

/// Print a tree error envelope to stdout (used on panic).
pub fn emit_tree_error(msg: String) {
    let out = ArchiveTreeOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

/// Print a file error envelope to stdout (used on panic).
pub fn emit_file_error(msg: String) {
    let out = ArchiveFileOutput {
        kind: "binary".into(),
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

/// Print an extract error envelope to stdout (used on panic).
pub fn emit_extract_error(msg: String) {
    let out = ArchiveExtractOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}
