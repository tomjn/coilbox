//! Archive browsing: list an archive's members (`tree`) and read a single member
//! for preview (`file`). Both go through unitsync's VFS (`OpenArchive` +
//! `FindFilesArchive`/`ReadArchiveFile`), so `.sd7`/`.sdz`/`.sdd` and rapid-pool
//! `.sdp` packages are read uniformly — each in its own one-shot `Init` session.

use crate::ffi::Unitsync;
use crate::model::{ArchiveFileEntry, ArchiveFileOutput, ArchiveTreeOutput};
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

    errors.extend(us.drain_errors());
    us.uninit();

    ArchiveTreeOutput {
        files,
        archive_path,
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
        Kind::Image if !oversize => ArchiveFileOutput {
            kind: "image".into(),
            data_url: Some(image_data_url(&ext, &bytes)),
            size,
            truncated: false,
            ..Default::default()
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

/// Map an extension to a preview kind and its byte cap. Images browsers can't
/// render (`.dds`, `.tga`, ...) deliberately fall through to binary.
fn classify(ext: &str) -> (Kind, usize) {
    const TEXT: &[&str] = &[
        "lua", "txt", "cfg", "json", "xml", "ini", "md", "glsl", "h", "tdf", "smd", "fbi", "gui",
        "bos", "yml", "yaml", "csv", "html", "css", "js",
    ];
    const IMAGE: &[&str] = &["png", "jpg", "jpeg", "gif", "bmp"];
    if TEXT.contains(&ext) {
        (Kind::Text, TEXT_CAP)
    } else if IMAGE.contains(&ext) {
        (Kind::Image, IMAGE_CAP)
    } else {
        (Kind::Binary, 0)
    }
}

fn image_data_url(ext: &str, bytes: &[u8]) -> String {
    let mime = match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:{mime};base64,{b64}")
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
