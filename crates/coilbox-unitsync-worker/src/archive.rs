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

    let archive_path = us.archive_path(archive_name).map(|dir| {
        Path::new(&dir)
            .join(archive_name)
            .to_string_lossy()
            .into_owned()
    });

    let files = match us.open_archive(archive_name) {
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

    let out = match us.open_archive(archive_name) {
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
