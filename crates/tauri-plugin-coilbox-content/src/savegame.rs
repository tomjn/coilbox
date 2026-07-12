//! Local singleplayer savegames: list the engine's `Saves/` folder and read each
//! save's map/game metadata. Two formats (confirmed against RecoilEngine's
//! `LoadSaveHandler`):
//!
//! - `.ssf` (Creg): gzip stream that opens with four NUL-terminated strings —
//!   sync-version, the start-script, the mod name, the map name.
//! - `.slsf` (Lua): zip archive whose `Spring/startscript.0` member is the
//!   start-script.
//!
//! Both ultimately carry the same start-script TDF that replays do, so map/game
//! extraction reuses [`crate::demo::script_map_and_game`]. The engine resumes a
//! save the same way it plays a replay: the save path is passed as the positional
//! launch argument (it dispatches on the `.ssf`/`.slsf` extension), so launching
//! lives in the play plugin, not here.

use flate2::read::GzDecoder;
use serde::Serialize;
use std::io::Read;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// The engine's savegame folder, relative to a content root's write dir.
const SAVE_DIR: &str = "Saves";
const SAVE_EXTS: &[&str] = &[".ssf", ".slsf"];

/// How many decompressed/zip bytes of a save to scan for the start-script prefix.
/// Start-scripts are a few KB; this bounds the read so a multi-MB save isn't fully
/// decompressed just to read its header strings.
const META_SCAN_CAP: usize = 256 * 1024;

/// The `Spring/startscript.0` member of a `.slsf` zip (RecoilEngine `PREFIX`).
const SLSF_SCRIPT_MEMBER: &str = "Spring/startscript.0";

/// One savegame on disk, with best-effort map/game metadata. `modifiedMs` (the file
/// mtime) is the save's date.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFile {
    pub filename: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_type: Option<String>,
}

/// List savegames under `<root>/Saves`, newest first. Metadata is best-effort:
/// a save whose format can't be read still appears (name + date only).
pub fn list_saves(root: &Path) -> Vec<SaveFile> {
    let mut out: Vec<SaveFile> = Vec::new();
    let Ok(rd) = std::fs::read_dir(root.join(SAVE_DIR)) else {
        return out;
    };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        if !SAVE_EXTS.iter().any(|ext| lower.ends_with(ext)) {
            continue;
        }
        let path = e.path();
        let md = e.metadata().ok();
        let size_bytes = md.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified_ms = md
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let (map_name, game_type) = read_metadata(&path).unwrap_or((None, None));
        out.push(SaveFile {
            filename: name,
            path: path.to_string_lossy().into_owned(),
            size_bytes,
            modified_ms,
            map_name,
            game_type,
        });
    }
    out.sort_by_key(|s| std::cmp::Reverse(s.modified_ms));
    out
}

/// Read `(mapName, gameType)` from a save, dispatching on extension.
fn read_metadata(path: &Path) -> Option<(Option<String>, Option<String>)> {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("ssf") => read_ssf(path),
        Some("slsf") => read_slsf(path),
        _ => None,
    }
}

/// `.ssf`: gunzip the prefix and read the leading NUL-terminated strings —
/// `[0]` sync-version, `[1]` start-script, `[2]` mod name, `[3]` map name.
fn read_ssf(path: &Path) -> Option<(Option<String>, Option<String>)> {
    let file = std::fs::File::open(path).ok()?;
    let mut buf = vec![0u8; META_SCAN_CAP];
    let n = read_up_to(&mut GzDecoder::new(file), &mut buf)?;
    buf.truncate(n);
    let mut parts = buf.split(|&b| b == 0);
    let _version = parts.next()?;
    let script = parts
        .next()
        .map(|s| String::from_utf8_lossy(s).into_owned());
    let mod_name = parts
        .next()
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .filter(|s| !s.is_empty());
    let map_name = parts
        .next()
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .filter(|s| !s.is_empty());
    // The explicit mod/map strings are authoritative; fall back to the embedded
    // start-script's `[GAME]` block if either is missing.
    let (script_map, script_game) = script
        .as_deref()
        .map(crate::demo::script_map_and_game)
        .unwrap_or((None, None));
    Some((map_name.or(script_map), mod_name.or(script_game)))
}

/// `.slsf`: read the zip's `Spring/startscript.0` member and parse its start-script.
fn read_slsf(path: &Path) -> Option<(Option<String>, Option<String>)> {
    let file = std::fs::File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(file).ok()?;
    let member = zip.by_name(SLSF_SCRIPT_MEMBER).ok()?;
    let mut script = String::new();
    member
        .take(META_SCAN_CAP as u64)
        .read_to_string(&mut script)
        .ok()?;
    Some(crate::demo::script_map_and_game(&script))
}

/// Read up to `buf.len()` bytes (as many as available), returning the count. `None`
/// only on the first-read IO error.
fn read_up_to<R: Read>(rdr: &mut R, buf: &mut [u8]) -> Option<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        match rdr.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(_) => break,
        }
    }
    (filled > 0).then_some(filled)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use std::io::Write;

    const SCRIPT: &str = "[GAME]\n{\n  MapName=Test Map;\n  GameType=Test Game 1.0;\n}\n";

    fn write_ssf(path: &Path) {
        let mut enc = GzEncoder::new(Vec::new(), Compression::default());
        // version \0 script \0 modName \0 mapName \0
        enc.write_all(b"1.0\0").unwrap();
        enc.write_all(SCRIPT.as_bytes()).unwrap();
        enc.write_all(b"\0Test Game 1.0\0Test Map\0").unwrap();
        let bytes = enc.finish().unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn lists_and_reads_ssf_metadata() {
        let dir = std::env::temp_dir().join(format!("cbx-saves-{}", std::process::id()));
        let saves = dir.join("Saves");
        std::fs::create_dir_all(&saves).unwrap();
        write_ssf(&saves.join("quicksave.ssf"));

        let list = list_saves(&dir);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].filename, "quicksave.ssf");
        assert_eq!(list[0].map_name.as_deref(), Some("Test Map"));
        assert_eq!(list[0].game_type.as_deref(), Some("Test Game 1.0"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_saves_dir_is_empty() {
        let dir = std::env::temp_dir().join(format!("cbx-saves-none-{}", std::process::id()));
        assert!(list_saves(&dir).is_empty());
    }
}
