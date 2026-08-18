//! Archive browsing: list an archive's members (`tree`) and read a single member
//! for preview (`file`). Both go through unitsync's VFS (`OpenArchive` +
//! `FindFilesArchive`/`ReadArchiveFile`), so `.sd7`/`.sdz`/`.sdd` and rapid-pool
//! `.sdp` packages are read uniformly — each in its own one-shot `Init` session.

use crate::ffi::Unitsync;
use crate::model::{
    ArchiveExtractOutput, ArchiveFileEntry, ArchiveFileOutput, ArchiveTreeOutput, GameHeaderItem,
    GameHeadersOutput, MapSkyboxOutput,
};
use base64::Engine;
use std::collections::HashMap;
use std::path::Path;

/// Text members are previewed up to 512 KiB; larger ones report as too large.
const TEXT_CAP: usize = 512 * 1024;
/// Image members are previewed up to 8 MiB.
const IMAGE_CAP: usize = 8 * 1024 * 1024;
/// Audio members are previewed up to 16 MiB (voice lines and short cues). A
/// bigger track still plays fine in-game, it is just too large to round-trip
/// as a data URL for preview.
const AUDIO_CAP: usize = 16 * 1024 * 1024;
/// Game-header loadpictures are read up to this size before downscaling. 4K PNGs
/// run ~12 MiB (past the preview cap), so the header cap is larger; anything
/// beyond it is treated as unusable rather than decoded.
const HEADER_READ_CAP: usize = 64 * 1024 * 1024;
/// Downscaled header art fits within this box (1080p), preserving aspect ratio.
const HEADER_MAX_W: u32 = 1920;
const HEADER_MAX_H: u32 = 1080;
/// JPEG quality for downscaled header art.
const HEADER_JPEG_QUALITY: u8 = 90;
/// Salts the header cache key. Bump when the header-art encoding changes so stale
/// entries (e.g. games rejected before downscaling existed) are invalidated and
/// re-resolved rather than served from an outdated cache. Version 3 switched the
/// hit file from base64 text to the raw JPEG the asset protocol serves.
const HEADER_CACHE_VERSION: u32 = 3;
/// How much of a candidate archive's `mapinfo.lua` is read when two archives
/// hold one `.smf` and only the declared name tells them apart. The map's own
/// `name` is at the top of the file, so this reaches it on any real map while
/// refusing to pull a whole generated file into memory.
const MAPINFO_CAP: usize = 64 * 1024;

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

/// The name the archive holding a game declares for itself, which is what a hub
/// row's `source_archive` carries (issue #1678).
///
/// The versioned name from modinfo, not the file name on disk, and the two are
/// not the same thing. Beyond All Reason installs through the rapid pool, so its
/// file is `ded9b29714a05164e4b4523b09809af2.sdp`, an md5 of the package's
/// contents. That names the file exactly and says nothing a person or a later
/// re-encode pass can use, while `Beyond All Reason test-30922-8064a43` names the
/// build. It is also the same string on every honest install of that build,
/// however it was installed, which is what coilbox-hub#116's anomaly check needs:
/// it only compares source bytes between rows that agree on this field, so a
/// value that moved with the install route would take the check off for anyone
/// who downloaded the archive rather than pulling it from rapid.
///
/// `GetPrimaryModArchiveList` gives the game's own archive first and its
/// dependencies after, so this is the archive the build pic was read out of.
/// `buildpic::resolve` opens the primary archive and nothing else, so the two
/// cannot come apart.
pub(crate) fn archive_name_for_game(us: &Unitsync, game_archive: &str) -> String {
    (0..us.mod_count())
        .find(|&i| us.mod_archive(i).as_deref() == Some(game_archive))
        .and_then(|i| us.mod_archives(i).into_iter().next())
        .unwrap_or_else(|| game_archive.to_string())
}

/// The same for the archive holding a map, which `GetMapArchiveName` already
/// reports under its versioned name.
///
/// That name is the map's own, so a map row's `source_archive` repeats its
/// `map_name`. That is not a stand-in for something better: coilbox-hub#100 makes
/// the versioned map name the whole of a map's identity precisely because a map
/// archive holds one map and is named after it, so there is nothing else about
/// the archive left to say.
///
/// The map's own archive comes first and `mapHelper` and friends after, so this
/// is the archive the infomap was read out of rather than one it depends on.
pub(crate) fn archive_name_for_map(us: &Unitsync, map_name: &str) -> String {
    us.map_archives(map_name)
        .into_iter()
        .next()
        .unwrap_or_else(|| map_name.to_string())
}

/// The absolute path of the archive file holding `map_name`, for a caller that
/// needs the bytes rather than a handle: the catalog's `source_hash` is over
/// them and its `archive_filename` is the file's own name (issue #1732).
///
/// `None` for a map whose archive is not a file under `maps/`, and for one this
/// cannot pick an archive for with certainty. A map installed through the rapid
/// pool or unpacked as a directory has no file to hash, and a wrong answer would
/// put another archive's hash on a public row, so neither produces an entry.
///
/// This does not go through [`resolve_open_path`], which stops at the first
/// archive holding the map's `.smf` and is right to: an archive browser showing
/// the wrong one of two lookalike archives is a display fault, and a catalog
/// entry claiming the wrong one is a false fact about somebody's install.
pub(crate) fn map_archive_file(us: &Unitsync, map_index: i32, map_name: &str) -> Option<String> {
    MapArchives::for_one_map(us, map_index).file_for(us, map_index, map_name)
}

/// Which archive under `maps/` holds each `.smf`, read once.
///
/// A walk over the whole library needs this and a single map does not, which is
/// the whole of why it is a type. Resolving one map means opening archives until
/// one holds its `.smf`, so three thousand maps resolved one at a time is
/// millions of archive opens. Built once it is one open each.
pub(crate) struct MapArchives {
    /// Lowercased `.smf` path to every archive holding one. More than one is the
    /// case [`MapArchives::file_for`] has to break a tie in.
    by_smf: HashMap<String, Vec<String>>,
}

impl MapArchives {
    /// One pass over every archive under `maps/`.
    pub(crate) fn index(us: &Unitsync) -> Self {
        let mut by_smf: HashMap<String, Vec<String>> = HashMap::new();
        for candidate in us.list_vfs_dir("maps", "*", "r") {
            if !is_archive_file(&candidate) {
                continue;
            }
            let Some(handle) = us.open_archive(&candidate) else {
                continue;
            };
            for (path, _) in us.list_archive_files(handle) {
                if path.to_lowercase().ends_with(".smf") {
                    by_smf
                        .entry(path.to_lowercase())
                        .or_default()
                        .push(candidate.clone());
                }
            }
            us.close_archive(handle);
        }
        Self { by_smf }
    }

    /// The archives holding one map\'s `.smf`, without reading the rest of the
    /// library. What a caller asking about a single map pays instead of the pass
    /// above.
    fn for_one_map(us: &Unitsync, map_index: i32) -> Self {
        let mut by_smf = HashMap::new();
        if let Some(smf) = us.map_file_name(map_index) {
            let holders = us
                .list_vfs_dir("maps", "*", "r")
                .into_iter()
                .filter(|c| is_archive_file(c))
                .filter(|cand| match us.open_archive(cand) {
                    Some(h) => {
                        let hit = us
                            .list_archive_files(h)
                            .iter()
                            .any(|(p, _)| same_member(p, &smf));
                        us.close_archive(h);
                        hit
                    }
                    None => false,
                })
                .collect();
            by_smf.insert(smf.to_lowercase(), holders);
        }
        Self { by_smf }
    }

    /// The absolute path of the archive file holding this map, or `None` when
    /// there is none or the tie cannot be broken.
    pub(crate) fn file_for(&self, us: &Unitsync, map_index: i32, map_name: &str) -> Option<String> {
        let smf = us.map_file_name(map_index)?.to_lowercase();
        let candidates = self.by_smf.get(&smf)?;
        let chosen = match candidates.len() {
            0 => return None,
            1 => candidates[0].clone(),
            _ => the_one_that_says_it_is_this_map(us, candidates, map_name)?,
        };
        absolute_archive_path(us, &chosen).filter(|p| Path::new(p).is_file())
    }
}

/// Which of several archives holding one `.smf` is the archive for this map.
///
/// A map made from another map keeps its parent's `.smf` file name, so the file
/// name is not the signature it looks like: this library has `fullmetal.smf` in
/// both Full Metal Plate 1.7 and Houses of Tripolis 1.3, and picking the first
/// hit gave one of them the other's bytes.
///
/// So the tie is broken on what each archive says it is. A map's canonical name
/// is its `mapinfo.lua` `name` and `version` joined, which is what
/// `GetNameVersioned` returns and therefore what `GetMapName` answered with, so
/// the archive whose declared name opens the canonical name is this map's.
///
/// `None` when no candidate says so, or when more than one does. Both mean the
/// archive cannot be named with certainty, and the caller wants no answer rather
/// than a plausible one.
fn the_one_that_says_it_is_this_map(
    us: &Unitsync,
    candidates: &[String],
    map_name: &str,
) -> Option<String> {
    let mut matched: Vec<&String> = Vec::new();
    for candidate in candidates {
        let Some(handle) = us.open_archive(candidate) else {
            continue;
        };
        let mapinfo = us
            .list_archive_files(handle)
            .into_iter()
            .find(|(p, _)| same_member(p, "mapinfo.lua"))
            .and_then(|(p, _)| us.read_archive_member(handle, &p, MAPINFO_CAP))
            .map(|(_, bytes)| String::from_utf8_lossy(&bytes).into_owned());
        us.close_archive(handle);

        if let Some(declared) = mapinfo.as_deref().and_then(declared_map_name) {
            if map_name
                .to_lowercase()
                .starts_with(&declared.to_lowercase())
            {
                matched.push(candidate);
            }
        }
    }
    match matched.as_slice() {
        [only] => Some((*only).clone()),
        _ => None,
    }
}

/// The map's own `name` out of a `mapinfo.lua`, read as a literal.
///
/// The first whole-word `name =` wins, which is the map's: the per terrain type
/// `name` entries come after it, by the convention
/// `tauri-plugin-coilbox-mapconv`'s own scanner relies on. A computed name is not
/// read at all, and a map with one is left for the caller to give up on rather
/// than guessed at.
fn declared_map_name(mapinfo: &str) -> Option<String> {
    let bytes = mapinfo.as_bytes();
    for at in 0..bytes.len().saturating_sub(4) {
        if !bytes[at..at + 4].eq_ignore_ascii_case(b"name") {
            continue;
        }
        if at > 0 && is_lua_ident(bytes[at - 1]) {
            continue;
        }
        let mut i = at + 4;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b'=' {
            continue;
        }
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        let Some(&quote) = bytes.get(i) else { continue };
        if quote != b'"' && quote != b'\'' {
            continue;
        }
        // The quotes are ASCII, so both offsets are character boundaries and the
        // slice holds whatever the map wrote between them.
        let Some(close) = bytes[i + 1..].iter().position(|&b| b == quote) else {
            continue;
        };
        let name = mapinfo[i + 1..i + 1 + close].trim();
        if !name.is_empty() {
            return Some(name.to_string());
        }
    }
    None
}

fn is_lua_ident(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

/// Read one member out of an archive file, by a name matched the way the VFS
/// matches it.
///
/// `archive_file` is a path [`map_archive_file`] resolved, and `member` is the
/// name something else reported, which may differ in case from the name the
/// archive's own directory holds (issue #1732). `None` when the archive will not
/// open, the member is not in it, or the read fails.
pub(crate) fn read_archive_member(
    us: &Unitsync,
    archive_file: &str,
    member: &str,
    cap: usize,
) -> Option<Vec<u8>> {
    let handle = us.open_archive(archive_file)?;
    let found = us
        .list_archive_files(handle)
        .into_iter()
        .find(|(path, _)| same_member(path, member))
        .map(|(path, _)| path);
    let read = found.and_then(|path| us.read_archive_member(handle, &path, cap));
    us.close_archive(handle);
    read.map(|(_, bytes)| bytes)
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
///
/// The `.smf` match is case-insensitive, because the two sides disagree and both
/// are right. `GetMapFileName` answers with the path the engine's map index
/// recorded and an archive lists the name its own directory holds, so Great
/// Divide V1 is `maps/Great_divide.smf` to one and `maps/Great_Divide.smf` to
/// the other. Spring's VFS matches paths case-insensitively itself, so an exact
/// comparison here was stricter than the thing it stands in for, and three of
/// this machine's 103 maps resolved to nothing because of it.
pub(crate) fn resolve_open_path(us: &Unitsync, name: &str) -> Option<String> {
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
                let hit = us
                    .list_archive_files(h)
                    .iter()
                    .any(|(p, _)| same_member(p, &smf));
                us.close_archive(h);
                hit
            }
            None => false,
        })
}

/// Whether two VFS paths name the same archive member, which Spring's own VFS
/// decides case-insensitively.
fn same_member(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
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
        // fall back to a text preview when the bytes are UTF-8, else binary.
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
        // Audio browsers can play natively, so it passes straight through as a
        // data URL (no transcode, unlike the image path's `.tga` case).
        Kind::Audio if !oversize => match audio_mime(&ext) {
            Some(mime) => ArchiveFileOutput {
                kind: "audio".into(),
                data_url: Some(raw_data_url(mime, &bytes)),
                size,
                truncated: false,
                ..Default::default()
            },
            None => ArchiveFileOutput {
                kind: "binary".into(),
                size,
                truncated: false,
                ..Default::default()
            },
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
    Audio,
    Binary,
}

/// Map an extension to a preview kind and its byte cap. `.tga` is decoded to PNG
/// for preview, other formats browsers can't render (`.dds`, ...) fall through to
/// binary.
fn classify(ext: &str) -> (Kind, usize) {
    const TEXT: &[&str] = &[
        "lua", "txt", "cfg", "json", "xml", "ini", "md", "glsl", "h", "tdf", "smd", "fbi", "gui",
        "bos", "yml", "yaml", "csv", "html", "css", "js",
    ];
    const IMAGE: &[&str] = &["png", "jpg", "jpeg", "gif", "bmp", "tga"];
    const AUDIO: &[&str] = &["ogg", "oga", "mp3", "wav", "flac", "opus", "m4a"];
    if TEXT.contains(&ext) {
        (Kind::Text, TEXT_CAP)
    } else if IMAGE.contains(&ext) {
        (Kind::Image, IMAGE_CAP)
    } else if AUDIO.contains(&ext) {
        (Kind::Audio, AUDIO_CAP)
    } else {
        (Kind::Binary, 0)
    }
}

/// The `audio/*` MIME type for a previewable audio extension, or `None` for an
/// extension `classify` never routes here.
fn audio_mime(ext: &str) -> Option<&'static str> {
    match ext {
        "ogg" | "oga" => Some("audio/ogg"),
        "mp3" => Some("audio/mpeg"),
        "wav" => Some("audio/wav"),
        "flac" => Some("audio/flac"),
        "opus" => Some("audio/opus"),
        "m4a" => Some("audio/mp4"),
        _ => None,
    }
}

/// Build a `data:` URL from a content type and raw bytes (the audio preview
/// path). The image path has its own encoder alongside the `.tga` transcode.
fn raw_data_url(content_type: &str, bytes: &[u8]) -> String {
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:{content_type};base64,{b64}")
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

/// Resolve every game's header art in one `Init` session, for the Games grid.
/// Mirrors `minimap::render_all`: the disk cache is keyed on a cheap file identity
/// (the primary archive's path + size + mtime) rather than the sync checksum, so
/// building art for the whole games list needs no per-game checksum work and keeps
/// the deferred-checksum scan cheap. A cache hit skips opening the archive.
pub fn game_headers(lib: &str, cache_dir: Option<&Path>) -> GameHeadersOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return GameHeadersOutput {
                headers: Vec::new(),
                errors: vec![e],
            }
        }
    };
    us.init(false, 0);
    let mut errors = us.drain_errors();

    let mut headers = Vec::new();
    for i in 0..us.mod_count() {
        let archive_name = us.mod_archive(i).unwrap_or_default();
        let info = us.mod_info(i);
        let name = info
            .get("name")
            .filter(|s| !s.is_empty())
            .cloned()
            .unwrap_or_else(|| archive_name.clone());
        let loadpicture = info.get("loadpicture").cloned().unwrap_or_default();

        // Cache is keyed on cheap file identity; `None` disables caching for this
        // game (it simply re-resolves).
        let key = game_cache_key(&us, &archive_name);
        let cache = cache_dir.zip(key.as_deref());

        if let Some((dir, key)) = cache {
            match read_header_cache(dir, key) {
                CacheState::Hit(file) => {
                    headers.push(GameHeaderItem {
                        name,
                        file: Some(file),
                        data_url: None,
                    });
                    continue;
                }
                CacheState::Negative => {
                    headers.push(GameHeaderItem {
                        name,
                        file: None,
                        data_url: None,
                    });
                    continue;
                }
                CacheState::Miss => {}
            }
        }

        let jpeg = match resolve_open_path(&us, &archive_name)
            .as_deref()
            .and_then(|p| us.open_archive(p))
        {
            Some(handle) => {
                let art = resolve_header_member(&us, handle, &loadpicture);
                us.close_archive(handle);
                art
            }
            None => {
                errors.push(format!("could not open archive {archive_name}"));
                None
            }
        };
        // Archive-open/probe diagnostics are per-game noise, not scan errors.
        let _ = us.drain_errors();

        // The webview fetches a cached header over `coilbox://unitsyncheader/`, so
        // only art that never reached disk pays for base64 on the bridge.
        let mut file = None;
        if let Some((dir, key)) = cache {
            match &jpeg {
                Some(bytes) => file = write_header_hit(dir, key, bytes),
                None => write_header_negative(dir, key),
            }
        }
        let data_url = match (&file, &jpeg) {
            (None, Some(bytes)) => Some(jpeg_to_data_url(bytes)),
            _ => None,
        };
        headers.push(GameHeaderItem {
            name,
            file,
            data_url,
        });
    }

    errors.extend(us.drain_errors());
    us.uninit();

    GameHeadersOutput { headers, errors }
}

/// A cheap, stable cache identity for a game's header art: a hash of its primary
/// archive's path + size + mtime. Mirrors `minimap::map_cache_key` — no
/// whole-archive checksum, so keying the whole games list is effectively free.
/// `None` (archive path doesn't resolve, or stat fails) disables caching.
fn game_cache_key(us: &Unitsync, archive_name: &str) -> Option<String> {
    use std::hash::{Hash, Hasher};
    let dir = us.archive_path(archive_name)?;
    let path = Path::new(&dir).join(archive_name);
    let md = std::fs::metadata(&path).ok()?;
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut h = std::collections::hash_map::DefaultHasher::new();
    HEADER_CACHE_VERSION.hash(&mut h);
    path.hash(&mut h);
    md.len().hash(&mut h);
    mtime.hash(&mut h);
    Some(format!("{:016x}", h.finish()))
}

/// Within an open archive, read the `loadpicture` member if given and decodable,
/// else a random `bitmaps/loadpictures/` image. Returns the JPEG bytes or `None`.
fn resolve_header_member(us: &Unitsync, handle: i32, loadpicture: &str) -> Option<Vec<u8>> {
    if !loadpicture.is_empty() {
        if let Some(jpeg) = read_image_member(us, handle, loadpicture) {
            return Some(jpeg);
        }
    }
    let mut candidates: Vec<String> = us
        .list_archive_files(handle)
        .into_iter()
        .map(|(path, _)| path)
        .filter(|p| is_loadpicture_image(p))
        .collect();
    candidates.sort();
    let idx = pick_index(candidates.len())?;
    read_image_member(us, handle, &candidates[idx])
}

/// Read one loadpicture member and return it as downscaled JPEG bytes, or `None`
/// if it isn't a decodable image. Unlike the raw preview path, header art is read
/// up to `HEADER_READ_CAP` and always re-encoded (see `encode_header_image`) so 4K
/// art still renders and every header stays small.
fn read_image_member(us: &Unitsync, handle: i32, inner: &str) -> Option<Vec<u8>> {
    let ext = inner.rsplit('.').next().unwrap_or("").to_lowercase();
    let (size, bytes) = us.read_archive_member(handle, inner, HEADER_READ_CAP)?;
    if size as usize > HEADER_READ_CAP {
        return None;
    }
    encode_header_image(&ext, &bytes)
}

/// Decode a loadpicture (by extension, since TGA has no magic bytes) and encode it
/// as a JPEG downscaled to fit within `HEADER_MAX_W`x`HEADER_MAX_H`. Aspect ratio
/// is preserved and smaller images keep their size (never upscaled). Alpha is
/// dropped, as loadpictures are opaque backgrounds, matching `tga_to_png`.
/// Re-encoding every header keeps oversized art (which overflows the raw preview
/// cap) renderable and bounds what the cache holds.
fn encode_header_image(ext: &str, bytes: &[u8]) -> Option<Vec<u8>> {
    let format = match ext {
        "png" => image::ImageFormat::Png,
        "jpg" | "jpeg" => image::ImageFormat::Jpeg,
        "gif" => image::ImageFormat::Gif,
        "bmp" => image::ImageFormat::Bmp,
        "tga" => image::ImageFormat::Tga,
        _ => return None,
    };
    let img = image::load_from_memory_with_format(bytes, format).ok()?;
    let img = if img.width() > HEADER_MAX_W || img.height() > HEADER_MAX_H {
        img.thumbnail(HEADER_MAX_W, HEADER_MAX_H)
    } else {
        img
    };
    let rgb = img.to_rgb8();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, HEADER_JPEG_QUALITY)
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .ok()?;
    Some(jpeg)
}

/// Wrap header JPEG bytes in a base64 `data:` URL, the fallback for art the cache
/// could not keep.
fn jpeg_to_data_url(jpeg: &[u8]) -> String {
    let b64 = base64::engine::general_purpose::STANDARD.encode(jpeg);
    format!("data:image/jpeg;base64,{b64}")
}

/// Image extensions we can turn into a `data:` URL for the header (matches the
/// formats `encode_preview_image` handles).
const HEADER_IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "gif", "bmp", "tga"];

/// Whether an archive member is an image inside `bitmaps/loadpictures/`.
fn is_loadpicture_image(path: &str) -> bool {
    let lower = path.to_lowercase();
    if !lower.starts_with("bitmaps/loadpictures/") {
        return false;
    }
    HEADER_IMAGE_EXTS
        .iter()
        .any(|ext| lower.ends_with(&format!(".{ext}")))
}

/// Pick an index in `0..len`, or `None` when `len == 0`. Uses wall-clock nanos as
/// a cheap one-time seed: the chosen image is frozen in the disk cache after the
/// first resolve, so this only needs to vary run-to-run, not be cryptographic.
fn pick_index(len: usize) -> Option<usize> {
    if len == 0 {
        return None;
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    Some((nanos % len as u128) as usize)
}

/// State of the header disk cache for one checksum.
#[derive(Debug)]
enum CacheState {
    /// `<checksum>.jpg` exists, holding the resolved art. Carries its file name,
    /// which is what the frontend appends to `coilbox://unitsyncheader/`.
    Hit(String),
    /// `<checksum>.none` marker exists, so the game has no usable art.
    Negative,
    /// Neither file exists, so the archive must be opened to resolve.
    Miss,
}

/// Look up the header cache for `checksum` under `dir`.
fn read_header_cache(dir: &Path, checksum: &str) -> CacheState {
    let file = format!("{checksum}.jpg");
    if dir.join(&file).is_file() {
        return CacheState::Hit(file);
    }
    if dir.join(format!("{checksum}.none")).exists() {
        return CacheState::Negative;
    }
    CacheState::Miss
}

/// Best-effort write of resolved header art to the cache, returning the file name
/// to serve it under. `None` when the write failed, so the caller inlines instead.
fn write_header_hit(dir: &Path, checksum: &str, jpeg: &[u8]) -> Option<String> {
    let _ = std::fs::create_dir_all(dir);
    let file = format!("{checksum}.jpg");
    std::fs::write(dir.join(&file), jpeg).ok().map(|()| file)
}

/// Best-effort write of the "no art" negative marker.
fn write_header_negative(dir: &Path, checksum: &str) {
    let _ = std::fs::create_dir_all(dir);
    let _ = std::fs::write(dir.join(format!("{checksum}.none")), b"");
}

/// A skybox DDS cube map is read up to this size (a 1024² DXT5 cube map with
/// mips is ~8 MiB; leave generous headroom for uncompressed or larger faces).
const SKYBOX_CAP: usize = 32 * 1024 * 1024;

/// Read a map's `atmosphere.skyBox` DDS cube map and return its raw bytes as a
/// `data:` URL (the frontend's `DDSLoader` parses it). Mounts the map's archives
/// so the Lua parser can read the skybox reference, then opens the map archive to
/// read that member. `None` (no skybox, or the member is missing/oversized) is the
/// common case and simply leaves the preview with its flat sky colour.
pub fn map_skybox(lib: &str, map_name: &str) -> MapSkyboxOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return MapSkyboxOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let mut errors = us.drain_errors();

    // The Lua parser reads mapinfo.lua from the VFS, so mount the map first.
    let mut skybox_name = None;
    if let Some(first) = us.map_archives(map_name).into_iter().next() {
        us.add_all_archives(&first);
        skybox_name = us.map_skybox_name();
    }
    // Mount/parse diagnostics are per-map noise, not a failure here.
    let _ = us.drain_errors();

    let data_url = match skybox_name {
        Some(name) => {
            let open_path = resolve_open_path(&us, map_name);
            let _ = us.drain_errors();
            match open_path.as_deref().and_then(|p| us.open_archive(p)) {
                Some(handle) => {
                    let url = read_skybox_member(&us, handle, &name);
                    us.close_archive(handle);
                    url
                }
                None => None,
            }
        }
        None => None,
    };
    let _ = us.drain_errors();

    errors.extend(us.drain_errors());
    us.uninit();
    MapSkyboxOutput { data_url, errors }
}

/// Within an open archive, locate the member the skybox reference points at
/// (case-insensitively; falling back to a basename match, since maps reference it
/// a few different ways) and return its raw bytes as a `data:` URL, or `None`.
fn read_skybox_member(us: &Unitsync, handle: i32, reference: &str) -> Option<String> {
    let want = reference.replace('\\', "/").to_lowercase();
    let base = want.rsplit('/').next().unwrap_or(&want).to_string();
    let files = us.list_archive_files(handle);
    let member = files
        .iter()
        .map(|(p, _)| p)
        .find(|p| p.to_lowercase() == want)
        .or_else(|| {
            files
                .iter()
                .map(|(p, _)| p)
                .find(|p| p.to_lowercase().rsplit('/').next() == Some(base.as_str()))
        })?
        .clone();

    let (size, bytes) = us.read_archive_member(handle, &member, SKYBOX_CAP)?;
    if size as usize > SKYBOX_CAP {
        return None;
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:application/octet-stream;base64,{b64}"))
}

/// Print a skybox error envelope to stdout (used on panic).
pub fn emit_skybox_error(msg: String) {
    let out = MapSkyboxOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
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

#[cfg(test)]
mod header_tests {
    use super::*;

    #[test]
    fn loadpictures_filter_matches_images_only() {
        assert!(is_loadpicture_image("bitmaps/loadpictures/load01.jpg"));
        assert!(is_loadpicture_image("bitmaps/loadpictures/deep/art.PNG"));
        assert!(is_loadpicture_image("BITMAPS/LOADPICTURES/x.tga"));
        // wrong folder
        assert!(!is_loadpicture_image("bitmaps/other/load01.jpg"));
        // right folder, non-image
        assert!(!is_loadpicture_image("bitmaps/loadpictures/readme.txt"));
        // the folder entry itself
        assert!(!is_loadpicture_image("bitmaps/loadpictures/"));
    }

    /// Encode a solid-colour RGB image of `w`x`h` as PNG bytes for the tests.
    fn png_bytes(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbImage::from_pixel(w, h, image::Rgb([10, 120, 220]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[test]
    fn oversized_header_is_downscaled_to_jpeg() {
        // A 4K image (larger than the 1080p box) comes back as a JPEG that fits.
        let raw = encode_header_image("png", &png_bytes(3840, 2160)).unwrap();
        let out = image::load_from_memory_with_format(&raw, image::ImageFormat::Jpeg).unwrap();
        assert!(out.width() <= HEADER_MAX_W && out.height() <= HEADER_MAX_H);
        // Aspect ratio (16:9) is preserved: downscaled to the box width.
        assert_eq!(out.width(), HEADER_MAX_W);
    }

    #[test]
    fn small_header_keeps_its_size() {
        let raw = encode_header_image("png", &png_bytes(320, 200)).unwrap();
        let out = image::load_from_memory_with_format(&raw, image::ImageFormat::Jpeg).unwrap();
        assert_eq!((out.width(), out.height()), (320, 200));
    }

    #[test]
    fn header_data_url_is_the_fallback_for_uncached_art() {
        assert_eq!(
            jpeg_to_data_url(b"hello"),
            "data:image/jpeg;base64,aGVsbG8="
        );
    }

    #[test]
    fn undecodable_header_bytes_return_none() {
        assert!(encode_header_image("png", b"not a png").is_none());
        // Coilbox does encode WebP now, in `assetencode` (issue #1623), but that
        // is the hub's corpus and this is the game header. The header is decoded
        // by extension against the `image` decoders the worker builds, which do
        // not include WebP, and it is re-encoded as a JPEG for the webview
        // regardless. So a `.webp` loadpicture is still a header we skip, and
        // this stays a statement about the header path rather than about what
        // coilbox can encode.
        assert!(encode_header_image("webp", &png_bytes(8, 8)).is_none());
    }

    #[test]
    fn pick_index_is_bounded() {
        assert_eq!(pick_index(0), None);
        for len in 1..=8usize {
            let i = pick_index(len).unwrap();
            assert!(i < len, "index {i} out of bounds for len {len}");
        }
    }

    #[test]
    fn cache_lookup_reports_hit_none_and_miss() {
        let dir = std::env::temp_dir().join("coilbox_header_cache_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Miss when neither file exists.
        assert!(matches!(read_header_cache(&dir, "aaaa"), CacheState::Miss));

        // Positive hit, reported by the file name the asset protocol serves.
        std::fs::write(dir.join("bbbb.jpg"), b"jpeg bytes").unwrap();
        match read_header_cache(&dir, "bbbb") {
            CacheState::Hit(file) => assert_eq!(file, "bbbb.jpg"),
            other => panic!("expected hit, got {other:?}"),
        }

        // Negative hit.
        std::fs::write(dir.join("cccc.none"), "").unwrap();
        assert!(matches!(
            read_header_cache(&dir, "cccc"),
            CacheState::Negative
        ));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_helpers_create_expected_files() {
        let dir = std::env::temp_dir().join("coilbox_header_write_test");
        let _ = std::fs::remove_dir_all(&dir);

        let file = write_header_hit(&dir, "dddd", b"jpeg bytes");
        assert_eq!(file.as_deref(), Some("dddd.jpg"));
        assert_eq!(std::fs::read(dir.join("dddd.jpg")).unwrap(), b"jpeg bytes");

        write_header_negative(&dir, "eeee");
        assert!(dir.join("eeee.none").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_routes_known_extensions_to_their_kind() {
        assert!(matches!(classify("lua").0, Kind::Text));
        assert!(matches!(classify("png").0, Kind::Image));
        assert!(matches!(classify("ogg").0, Kind::Audio));
        assert!(matches!(classify("mp3").0, Kind::Audio));
        assert!(matches!(classify("dds").0, Kind::Binary));
        assert!(matches!(classify("").0, Kind::Binary));
    }

    #[test]
    fn classify_caps_match_the_kind() {
        assert_eq!(classify("lua").1, TEXT_CAP);
        assert_eq!(classify("png").1, IMAGE_CAP);
        assert_eq!(classify("wav").1, AUDIO_CAP);
        assert_eq!(classify("dds").1, 0);
    }

    #[test]
    fn audio_mime_maps_every_previewable_extension() {
        assert_eq!(audio_mime("ogg"), Some("audio/ogg"));
        assert_eq!(audio_mime("oga"), Some("audio/ogg"));
        assert_eq!(audio_mime("mp3"), Some("audio/mpeg"));
        assert_eq!(audio_mime("wav"), Some("audio/wav"));
        assert_eq!(audio_mime("flac"), Some("audio/flac"));
        assert_eq!(audio_mime("opus"), Some("audio/opus"));
        assert_eq!(audio_mime("m4a"), Some("audio/mp4"));
        assert_eq!(audio_mime("dds"), None);
    }

    #[test]
    fn raw_data_url_builds_a_valid_base64_data_uri() {
        let url = raw_data_url("audio/ogg", b"hello");
        assert_eq!(url, "data:audio/ogg;base64,aGVsbG8=");
    }

    /// The three real pairs from this machine's library, where unitsync's map
    /// index and the archive's own directory spell one file two ways. Matching
    /// them exactly left those maps with no resolvable archive at all.
    #[test]
    fn a_member_is_the_same_member_whatever_its_case() {
        for (indexed, listed) in [
            ("maps/Great_divide.smf", "maps/Great_Divide.smf"),
            (
                "maps/Industrial_Revolution_V2.smf",
                "maps/Industrial_Revolution_v2.smf",
            ),
            ("maps/Raptor_Crater_V2.smf", "maps/Raptor_Crater_v2.smf"),
        ] {
            assert!(same_member(indexed, listed), "{indexed} vs {listed}");
        }
        assert!(!same_member(
            "maps/Great_Divide.smf",
            "maps/Small_Divide.smf"
        ));
    }

    /// The map's own name, which is the first `name =` in the file. The terrain
    /// types below it have names too, and reading one of those would name the
    /// wrong archive rather than none.
    #[test]
    fn the_declared_name_is_the_maps_own_and_not_a_terrain_types() {
        let mapinfo = r#"
            local mapinfo = {
              name = "Houses of Tripolis",
              shortname = "HoT",
              description = "A city map",
              version = "1.3",
              terrainTypes = {
                [0] = { name = "Default", hardness = 1 },
                [1] = { name = "Road", hardness = 4 },
              },
            }
            return mapinfo
        "#;
        assert_eq!(
            declared_map_name(mapinfo).as_deref(),
            Some("Houses of Tripolis")
        );
    }

    /// The two spellings a map may use, and the whole-word rule that keeps
    /// `shortname` and `filename` out of it.
    #[test]
    fn a_name_is_read_however_the_map_wrote_it() {
        assert_eq!(declared_map_name("Name='Isis'").as_deref(), Some("Isis"));
        assert_eq!(
            declared_map_name("shortname = \"ISIS\"\nname = \"Isis\"").as_deref(),
            Some("Isis")
        );
        assert_eq!(declared_map_name("name = mapName .. version"), None);
        assert_eq!(declared_map_name("-- no name here"), None);
        assert_eq!(declared_map_name("name = \"\"").as_deref(), None);
    }

    /// What the tie break then does with it: a declared name opens the canonical
    /// name, so Full Metal Plate's archive cannot claim Houses of Tripolis.
    #[test]
    fn a_declared_name_opens_the_canonical_name_of_its_own_map_only() {
        let canonical = "Houses of Tripolis 1.3".to_lowercase();
        assert!(canonical.starts_with(&"Houses of Tripolis".to_lowercase()));
        assert!(!canonical.starts_with(&"Full Metal Plate".to_lowercase()));
    }
}
