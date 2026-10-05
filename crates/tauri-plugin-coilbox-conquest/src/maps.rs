//! Hand-made map folders: listing them, and importing one from a zip file.
//!
//! A map folder is any directory holding a `map.json`. The frontend owns the
//! manifest format (see `src/conquest/handmade/`), so this module reads only
//! the manifest's `id`, which names the folder an imported map is stored in.
//!
//! A zip comes from a stranger. It is unpacked into a staging folder inside the
//! data folder and only renamed into place once the frontend has read it, so a
//! refused or unreadable zip leaves nothing behind and never damages a map that
//! is already installed.

use coilbox_portable::{is_safe_rel, valid_id};
use serde::Serialize;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// The manifest's file name. Mirrors `MANIFEST_FILE` in the frontend reader.
pub const MANIFEST_FILE: &str = "map.json";

/// The most a zip may unpack to. This is a reasoned ceiling, not a measurement:
/// the only map that exists today is the sample, whose images are about a
/// kilobyte each. A folder holds three images (picture, provinces, heightmap).
/// A 4096 by 4096 image is 64 MiB as raw RGBA, and its PNG is smaller than
/// that, so three images fit in 192 MiB. The rest is left for glTF models,
/// which the manifest reserves a key for. Revisit once authors have made maps.
/// `RAW_CAP` in the unitsync worker's `archive.rs` is the same number, for one
/// file of a map a game carries. Change both together.
pub const MAX_UNPACKED_BYTES: u64 = 256 * 1024 * 1024;

/// The most entries a zip may hold, counting the ones that are skipped. A guess
/// with no map to measure: a folder is a manifest, three images and some
/// models, and macOS adds a hidden twin for each file. It bounds the work spent
/// walking a hostile archive before any byte is written.
pub const MAX_ENTRIES: usize = 1024;

/// File types a map folder can use. Anything else in a zip is skipped, so a
/// stranger's archive cannot put a script or a web page in the data folder.
const ALLOWED_EXTENSIONS: &[&str] = &["json", "png", "jpg", "jpeg", "webp", "gltf", "glb", "bin"];

/// The limits one unpack runs under. The commands use [`Limits::DEFAULT`], and
/// the tests pass small ones.
#[derive(Clone, Copy)]
pub struct Limits {
    pub max_bytes: u64,
    pub max_entries: usize,
}

impl Limits {
    pub const DEFAULT: Limits = Limits {
        max_bytes: MAX_UNPACKED_BYTES,
        max_entries: MAX_ENTRIES,
    };
}

/// One map folder: its manifest text and the files beside it. The frontend
/// parses the manifest and builds the file URLs.
#[derive(Serialize, Debug)]
pub struct MapItem {
    /// The directory name. For an imported map this is the manifest's id.
    pub folder: String,
    pub source: &'static str, // "imported" | "bundled"
    pub manifest: String,
    /// Paths of the folder's files relative to it, with `/` separators.
    pub files: Vec<String>,
}

/// A zip unpacked into staging, waiting for the frontend to read it.
#[derive(Serialize, Debug)]
pub struct Staged {
    pub token: String,
    pub id: String,
    pub manifest: String,
    pub files: Vec<String>,
    /// How many entries were left out: hidden files and unknown file types.
    pub skipped: usize,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Commit {
    Imported,
    /// A map with this id is installed and `replace` was not set.
    Exists,
}

/// The `id` of a manifest, when it has one that is safe to use as a folder
/// name. The frontend reader applies the same character rule.
pub fn manifest_id(text: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let id = value.get("id")?.as_str()?;
    valid_id(id).then(|| id.to_string())
}

/// Every file under `dir` as a `/` separated relative path, sorted. Symlinks
/// are left out, so a listed file is always inside the folder.
fn list_files(dir: &Path) -> Vec<String> {
    fn walk(dir: &Path, prefix: &str, out: &mut Vec<String>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            let rel = format!("{prefix}{name}");
            if kind.is_file() {
                out.push(rel);
            } else if kind.is_dir() {
                walk(&entry.path(), &format!("{rel}/"), out);
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, "", &mut out);
    out.sort();
    out
}

/// Append every map folder directly under `dir` to `items`. A missing
/// directory, or a folder whose manifest cannot be read as text, is skipped.
pub fn list_maps(dir: &Path, source: &'static str, items: &mut Vec<MapItem>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut found: Vec<MapItem> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| {
            let folder = e.file_name().to_str()?.to_string();
            let manifest = std::fs::read_to_string(e.path().join(MANIFEST_FILE)).ok()?;
            Some(MapItem {
                folder,
                source,
                manifest,
                files: list_files(&e.path()),
            })
        })
        .collect();
    found.sort_by(|a, b| a.folder.cmp(&b.folder));
    items.append(&mut found);
}

/// True when a map folder under `dir` declares `id`.
fn dir_has_id(dir: &Path, id: &str) -> bool {
    let mut items = Vec::new();
    list_maps(dir, "", &mut items);
    items
        .iter()
        .any(|m| manifest_id(&m.manifest).as_deref() == Some(id))
}

/// The safe relative path of a zip entry, or an error naming why it is refused.
/// `enclosed_name` already refuses a path that climbs out, but it accepts
/// `a/../b`, so the raw name is checked as well.
fn entry_path(raw: &str, enclosed: Option<PathBuf>) -> Result<PathBuf, String> {
    let refuse = |why: &str| Err(format!("The zip holds \"{raw}\", which {why}."));
    if raw.starts_with('/') || raw.starts_with('\\') {
        return refuse("is an absolute path");
    }
    if raw.chars().any(|c| c == '\\' || c == ':' || c.is_control()) {
        return refuse("has a character a file name cannot use");
    }
    if raw.split('/').any(|part| part == "..") {
        return refuse("points outside the map folder");
    }
    match enclosed {
        Some(path) if is_safe_rel(&path) => Ok(path),
        _ => refuse("points outside the map folder"),
    }
}

/// True for an entry that is left out without refusing the zip: anything under
/// `__MACOSX`, any hidden file or folder, and any file type a map does not use.
fn is_skipped(path: &Path) -> bool {
    let hidden = path.components().any(|c| {
        let name = c.as_os_str().to_string_lossy();
        name.starts_with('.') || name == "__MACOSX"
    });
    let allowed = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .is_some_and(|e| ALLOWED_EXTENSIONS.contains(&e.as_str()));
    hidden || !allowed
}

/// Unpack the zip at `zip_path` into `dest`, which must exist and be empty.
/// Returns how many entries were skipped. On an error `dest` may hold files,
/// and the caller removes it.
fn unpack(zip_path: &Path, dest: &Path, limits: Limits) -> Result<usize, String> {
    let file = File::open(zip_path).map_err(|e| format!("Could not open the zip file: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("This is not a zip file: {e}"))?;
    if archive.len() > limits.max_entries {
        return Err(format!(
            "The zip holds {} entries, and a map may hold {} at most.",
            archive.len(),
            limits.max_entries
        ));
    }

    // First pass, names only: refuse the whole zip before writing anything.
    let mut kept: Vec<(usize, PathBuf)> = Vec::new();
    let mut skipped = 0;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|e| format!("Could not read the zip file: {e}"))?;
        let raw = entry.name().to_string();
        if entry.is_symlink() {
            return Err(format!(
                "The zip holds \"{raw}\", which is a link to another file. A map may hold only files."
            ));
        }
        let path = entry_path(&raw, entry.enclosed_name())?;
        if entry.is_dir() {
            continue;
        }
        if is_skipped(&path) {
            skipped += 1;
        } else {
            kept.push((index, path));
        }
    }

    // The manifest sits at the top level, or every file sits in one top folder.
    let manifest = Path::new(MANIFEST_FILE);
    let prefix: PathBuf = if kept.iter().any(|(_, p)| p == manifest) {
        PathBuf::new()
    } else {
        let top = kept
            .first()
            .and_then(|(_, p)| p.components().next())
            .map(|c| PathBuf::from(c.as_os_str()));
        match top {
            Some(top)
                if kept.iter().all(|(_, p)| p.starts_with(&top))
                    && kept.iter().any(|(_, p)| *p == top.join(manifest)) =>
            {
                top
            }
            _ => {
                return Err(format!(
                    "The zip has no {MANIFEST_FILE} at its top level or inside a single folder."
                ))
            }
        }
    };

    // Second pass: write, counting real bytes. The size a zip declares for an
    // entry is the archive's own claim, so it is never used.
    let mut remaining = limits.max_bytes;
    let mut buf = vec![0u8; 64 * 1024];
    for (index, path) in kept {
        let rel = path
            .strip_prefix(&prefix)
            .map_err(|_| "Could not read the zip file.".to_string())?;
        let target = dest.join(rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Could not unpack the zip file: {e}"))?;
        }
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("Could not read the zip file: {e}"))?;
        // `create_new` refuses a second entry with the same name.
        let mut out = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|e| format!("Could not unpack \"{}\": {e}", rel.display()))?;
        loop {
            let n = entry
                .read(&mut buf)
                .map_err(|e| format!("Could not read \"{}\" from the zip: {e}", rel.display()))?;
            if n == 0 {
                break;
            }
            if n as u64 > remaining {
                return Err(format!(
                    "The zip unpacks to more than {} MB, which is larger than a map may be.",
                    limits.max_bytes / (1024 * 1024)
                ));
            }
            remaining -= n as u64;
            out.write_all(&buf[..n])
                .map_err(|e| format!("Could not unpack \"{}\": {e}", rel.display()))?;
        }
    }
    Ok(skipped)
}

/// A folder name no other import has used: the clock and the process id. It
/// passes `valid_id`, which the asset protocol requires of it.
fn new_token() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}-{:x}", std::process::id())
}

/// Unpack a zip into a fresh folder under `staging_root` and check it holds a
/// manifest with a usable id. Anything left in staging by an earlier import is
/// cleared first. On an error nothing is left behind.
pub fn stage(zip_path: &Path, staging_root: &Path, limits: Limits) -> Result<Staged, String> {
    if staging_root.exists() {
        std::fs::remove_dir_all(staging_root)
            .map_err(|e| format!("Could not clear the import folder: {e}"))?;
    }
    let token = new_token();
    let dest = staging_root.join(&token);
    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("Could not create the import folder: {e}"))?;

    let staged = unpack(zip_path, &dest, limits).and_then(|skipped| {
        let manifest = std::fs::read_to_string(dest.join(MANIFEST_FILE))
            .map_err(|e| format!("Could not read {MANIFEST_FILE} from the zip: {e}"))?;
        // A manifest that is not JSON is the reader's to explain, so only a
        // readable one with a bad id is refused here.
        let id = match serde_json::from_str::<serde_json::Value>(&manifest) {
            Ok(_) => manifest_id(&manifest).ok_or_else(|| {
                format!("{MANIFEST_FILE} needs an \"id\" made of letters, digits and -.")
            })?,
            Err(_) => String::new(),
        };
        Ok(Staged {
            token: token.clone(),
            id,
            manifest,
            files: list_files(&dest),
            skipped,
        })
    });
    if staged.is_err() {
        let _ = std::fs::remove_dir_all(staging_root);
    }
    staged
}

/// Remove a staged import. A token that is not staged is fine.
pub fn discard(staging_root: &Path, token: &str) -> Result<(), String> {
    if !valid_id(token) {
        return Err(format!("invalid import token: {token}"));
    }
    match std::fs::remove_dir_all(staging_root.join(token)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not remove the unpacked map: {e}")),
    }
}

/// Move a staged map into `maps_dir/<id>`. A map with that id already there is
/// replaced only when `replace` is set. Otherwise the staged copy is kept and
/// [`Commit::Exists`] is returned so the caller can ask. An id a bundled map
/// uses is refused, because a bundled map cannot be replaced or removed.
pub fn commit(
    staging_root: &Path,
    maps_dir: &Path,
    bundled_dir: Option<&Path>,
    token: &str,
    replace: bool,
) -> Result<(Commit, String), String> {
    if !valid_id(token) {
        return Err(format!("invalid import token: {token}"));
    }
    let staged = staging_root.join(token);
    let manifest = std::fs::read_to_string(staged.join(MANIFEST_FILE))
        .map_err(|_| "This import is no longer waiting. Import the zip again.".to_string())?;
    let id = manifest_id(&manifest)
        .ok_or_else(|| format!("{MANIFEST_FILE} needs an \"id\" made of letters, digits and -."))?;
    if bundled_dir.is_some_and(|dir| dir_has_id(dir, &id)) {
        return Err(format!(
            "A map with the id \"{id}\" ships with this copy of coilbox and cannot be replaced."
        ));
    }

    let target = maps_dir.join(&id);
    let exists = target.exists();
    if exists && !replace {
        return Ok((Commit::Exists, id));
    }
    std::fs::create_dir_all(maps_dir)
        .map_err(|e| format!("Could not create the maps folder: {e}"))?;
    // The old map is moved aside first and put back if the new one cannot be
    // moved in, so a failed replace leaves the installed map as it was.
    let aside = staging_root.join(format!("{token}-old"));
    if exists {
        std::fs::rename(&target, &aside)
            .map_err(|e| format!("Could not replace the installed map: {e}"))?;
    }
    if let Err(e) = std::fs::rename(&staged, &target) {
        if exists {
            let _ = std::fs::rename(&aside, &target);
        }
        return Err(format!("Could not install the map: {e}"));
    }
    let _ = std::fs::remove_dir_all(staging_root);
    Ok((Commit::Imported, id))
}

/// Remove the imported map `id`. A bundled map is refused. An id nothing uses
/// is fine.
pub fn remove(maps_dir: &Path, bundled_dir: Option<&Path>, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(format!("invalid map id: {id}"));
    }
    let target = maps_dir.join(id);
    if !target.exists() {
        if bundled_dir.is_some_and(|dir| dir_has_id(dir, id)) {
            return Err(format!(
                "\"{id}\" ships with this copy of coilbox and cannot be removed."
            ));
        }
        return Ok(());
    }
    std::fs::remove_dir_all(&target).map_err(|e| format!("Could not remove the map: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use zip::write::SimpleFileOptions;

    const MANIFEST: &str = r#"{"id":"two-shores","title":"Two Shores"}"#;

    const SMALL: Limits = Limits {
        max_bytes: 64 * 1024,
        max_entries: 16,
    };

    /// A zip of `(name, bytes)` entries written to `dir/map.zip`.
    fn zip_of(dir: &Path, entries: &[(&str, &[u8])]) -> PathBuf {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        let path = dir.join("map.zip");
        std::fs::write(&path, writer.finish().unwrap().into_inner()).unwrap();
        path
    }

    /// The tree a test works in: the zip's folder, staging, maps and bundled.
    struct Dirs {
        _tmp: tempfile::TempDir,
        zips: PathBuf,
        staging: PathBuf,
        maps: PathBuf,
        bundled: PathBuf,
    }

    fn dirs() -> Dirs {
        let tmp = tempfile::tempdir().unwrap();
        let at = |name: &str| tmp.path().join(name);
        std::fs::create_dir_all(at("zips")).unwrap();
        Dirs {
            zips: at("zips"),
            staging: at("data/conquest/map-staging"),
            maps: at("data/conquest/maps"),
            bundled: at("bundled"),
            _tmp: tmp,
        }
    }

    /// Every path under the data folder, so a test can show nothing was left.
    fn leftovers(d: &Dirs) -> Vec<String> {
        let mut all = list_files(&d.staging);
        all.extend(list_files(&d.maps));
        all
    }

    fn import(d: &Dirs, zip: &Path, replace: bool) -> Result<(Commit, String), String> {
        let staged = stage(zip, &d.staging, SMALL)?;
        commit(
            &d.staging,
            &d.maps,
            Some(&d.bundled),
            &staged.token,
            replace,
        )
    }

    #[test]
    fn imports_a_zip_with_its_files_at_the_top_level() {
        let d = dirs();
        let zip = zip_of(
            &d.zips,
            &[("map.json", MANIFEST.as_bytes()), ("picture.png", b"png")],
        );
        let staged = stage(&zip, &d.staging, SMALL).unwrap();
        assert_eq!(staged.id, "two-shores");
        assert_eq!(staged.files, ["map.json", "picture.png"]);

        let done = commit(&d.staging, &d.maps, None, &staged.token, false).unwrap();
        assert_eq!(done, (Commit::Imported, "two-shores".to_string()));
        assert_eq!(
            std::fs::read(d.maps.join("two-shores/picture.png")).unwrap(),
            b"png"
        );
        assert!(!d.staging.exists());
    }

    #[test]
    fn imports_a_zip_with_its_files_inside_one_folder() {
        let d = dirs();
        let zip = zip_of(
            &d.zips,
            &[
                ("My Map/map.json", MANIFEST.as_bytes()),
                ("My Map/picture.png", b"png"),
                ("My Map/models/tower.glb", b"glb"),
                // What macOS adds when it zips a folder, and a stray file type.
                ("__MACOSX/My Map/._map.json", b"x"),
                ("My Map/.DS_Store", b"x"),
                ("My Map/run.sh", b"x"),
            ],
        );
        let staged = stage(&zip, &d.staging, SMALL).unwrap();
        assert_eq!(
            staged.files,
            ["map.json", "models/tower.glb", "picture.png"]
        );
        assert_eq!(staged.skipped, 3);
    }

    #[test]
    fn refuses_a_zip_with_no_manifest_and_leaves_nothing() {
        let d = dirs();
        let zip = zip_of(&d.zips, &[("a/picture.png", b"png"), ("b/map.json", b"{}")]);
        let err = stage(&zip, &d.staging, SMALL).unwrap_err();
        assert!(err.contains("no map.json"), "{err}");
        assert!(leftovers(&d).is_empty());
        assert!(!d.staging.exists());
    }

    #[test]
    fn refuses_a_path_that_climbs_out() {
        let d = dirs();
        for name in ["../escape.png", "maps/../../escape.png", "a/../b.png"] {
            let zip = zip_of(
                &d.zips,
                &[("map.json", MANIFEST.as_bytes()), (name, b"png")],
            );
            let err = stage(&zip, &d.staging, SMALL).unwrap_err();
            assert!(err.contains("outside the map folder"), "{name}: {err}");
            assert!(leftovers(&d).is_empty(), "{name}");
            assert!(!d.zips.join("escape.png").exists(), "{name}");
        }
    }

    #[test]
    fn refuses_an_absolute_path() {
        let d = dirs();
        let outside = d.zips.join("escape.png");
        for name in [
            outside.to_str().unwrap(),
            "/escape.png",
            "\\escape.png",
            "C:\\escape.png",
            "C:/escape.png",
        ] {
            let zip = zip_of(
                &d.zips,
                &[("map.json", MANIFEST.as_bytes()), (name, b"png")],
            );
            assert!(stage(&zip, &d.staging, SMALL).is_err(), "{name}");
            assert!(leftovers(&d).is_empty(), "{name}");
            assert!(!outside.exists(), "{name}");
        }
    }

    #[test]
    fn refuses_a_symlink_entry() {
        let d = dirs();
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file("map.json", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(MANIFEST.as_bytes()).unwrap();
        writer
            .add_symlink("picture.png", "/etc/passwd", SimpleFileOptions::default())
            .unwrap();
        let zip = d.zips.join("map.zip");
        std::fs::write(&zip, writer.finish().unwrap().into_inner()).unwrap();

        let err = stage(&zip, &d.staging, SMALL).unwrap_err();
        assert!(err.contains("link to another file"), "{err}");
        assert!(leftovers(&d).is_empty());
    }

    #[test]
    fn refuses_a_zip_over_the_size_cap() {
        let d = dirs();
        let big = vec![0u8; SMALL.max_bytes as usize + 1];
        let zip = zip_of(
            &d.zips,
            &[("map.json", MANIFEST.as_bytes()), ("p.png", &big)],
        );
        let err = stage(&zip, &d.staging, SMALL).unwrap_err();
        assert!(err.contains("larger than a map may be"), "{err}");
        assert!(leftovers(&d).is_empty());
    }

    /// Overwrite every copy of an entry's declared unpacked size. The size sits
    /// 22 bytes into a local header and 24 bytes into a central one.
    fn declare_size(zip: &mut [u8], real: u32, claimed: u32) -> usize {
        let mut patched = 0;
        for (signature, offset) in [(b"PK\x03\x04", 22), (b"PK\x01\x02", 24)] {
            for at in 0..zip.len().saturating_sub(offset + 4) {
                if &zip[at..at + 4] == signature
                    && zip[at + offset..at + offset + 4] == real.to_le_bytes()
                {
                    zip[at + offset..at + offset + 4].copy_from_slice(&claimed.to_le_bytes());
                    patched += 1;
                }
            }
        }
        patched
    }

    #[test]
    fn enforces_the_size_cap_on_a_zip_that_lies_about_its_size() {
        let d = dirs();
        // Zeros deflate to almost nothing, so the zip is tiny and unpacks big.
        let real = 4 * SMALL.max_bytes as u32;
        let big = vec![0u8; real as usize];
        let zip = zip_of(
            &d.zips,
            &[("map.json", MANIFEST.as_bytes()), ("p.png", &big)],
        );
        let mut bytes = std::fs::read(&zip).unwrap();
        assert_eq!(declare_size(&mut bytes, real, 10), 2);
        std::fs::write(&zip, bytes).unwrap();

        // The zip now claims the picture is 10 bytes.
        let mut archive = zip::ZipArchive::new(File::open(&zip).unwrap()).unwrap();
        assert_eq!(archive.by_name("p.png").unwrap().size(), 10);

        let err = stage(&zip, &d.staging, SMALL).unwrap_err();
        assert!(err.contains("larger than a map may be"), "{err}");
        assert!(leftovers(&d).is_empty());
    }

    #[test]
    fn refuses_a_zip_with_too_many_entries() {
        let d = dirs();
        let names: Vec<String> = (0..SMALL.max_entries).map(|i| format!("{i}.png")).collect();
        let mut entries: Vec<(&str, &[u8])> = vec![("map.json", MANIFEST.as_bytes())];
        entries.extend(names.iter().map(|n| (n.as_str(), b"x".as_slice())));
        let zip = zip_of(&d.zips, &entries);
        let err = stage(&zip, &d.staging, SMALL).unwrap_err();
        assert!(err.contains("entries"), "{err}");
        assert!(leftovers(&d).is_empty());
    }

    #[test]
    fn refuses_a_manifest_with_an_id_that_is_not_a_folder_name() {
        let d = dirs();
        let zip = zip_of(&d.zips, &[("map.json", br#"{"id":"../../escape"}"#)]);
        let err = stage(&zip, &d.staging, SMALL).unwrap_err();
        assert!(err.contains("\"id\""), "{err}");
        assert!(leftovers(&d).is_empty());
    }

    #[test]
    fn a_file_that_is_not_a_zip_leaves_nothing() {
        let d = dirs();
        let zip = d.zips.join("map.zip");
        std::fs::write(&zip, b"not a zip").unwrap();
        assert!(stage(&zip, &d.staging, SMALL).is_err());
        assert!(!d.staging.exists());
    }

    #[test]
    fn discarding_a_staged_import_leaves_nothing() {
        let d = dirs();
        let zip = zip_of(&d.zips, &[("map.json", MANIFEST.as_bytes())]);
        let staged = stage(&zip, &d.staging, SMALL).unwrap();
        discard(&d.staging, &staged.token).unwrap();
        assert!(leftovers(&d).is_empty());
        assert!(discard(&d.staging, "../maps").is_err());
    }

    #[test]
    fn replacing_an_installed_map_needs_the_flag() {
        let d = dirs();
        let first = zip_of(
            &d.zips,
            &[("map.json", MANIFEST.as_bytes()), ("picture.png", b"old")],
        );
        import(&d, &first, false).unwrap();

        let second = zip_of(
            &d.zips,
            &[("map.json", MANIFEST.as_bytes()), ("picture.png", b"new")],
        );
        let picture = d.maps.join("two-shores/picture.png");
        assert_eq!(import(&d, &second, false).unwrap().0, Commit::Exists);
        assert_eq!(std::fs::read(&picture).unwrap(), b"old");

        assert_eq!(import(&d, &second, true).unwrap().0, Commit::Imported);
        assert_eq!(std::fs::read(&picture).unwrap(), b"new");
        assert!(!d.staging.exists());
    }

    #[test]
    fn a_bundled_map_cannot_be_removed_or_replaced() {
        let d = dirs();
        // The folder name need not match the id.
        let folder = d.bundled.join("Two Shores");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("map.json"), MANIFEST).unwrap();

        let err = remove(&d.maps, Some(&d.bundled), "two-shores").unwrap_err();
        assert!(err.contains("cannot be removed"), "{err}");
        assert!(folder.join("map.json").exists());

        let zip = zip_of(&d.zips, &[("map.json", MANIFEST.as_bytes())]);
        let err = import(&d, &zip, true).unwrap_err();
        assert!(err.contains("cannot be replaced"), "{err}");
        assert!(list_files(&d.maps).is_empty());
    }

    #[test]
    fn removes_an_imported_map_and_guards_the_id() {
        let d = dirs();
        let zip = zip_of(&d.zips, &[("map.json", MANIFEST.as_bytes())]);
        import(&d, &zip, false).unwrap();

        assert!(remove(&d.maps, Some(&d.bundled), "../zips").is_err());
        assert!(zip.exists());

        remove(&d.maps, Some(&d.bundled), "two-shores").unwrap();
        assert!(!d.maps.join("two-shores").exists());
        // Removing it again is fine.
        remove(&d.maps, Some(&d.bundled), "two-shores").unwrap();
    }

    #[test]
    fn lists_map_folders_and_skips_other_directories() {
        let d = dirs();
        let map = d.bundled.join("shores");
        std::fs::create_dir_all(map.join("models")).unwrap();
        std::fs::write(map.join("map.json"), MANIFEST).unwrap();
        std::fs::write(map.join("models/tower.glb"), b"glb").unwrap();
        std::fs::create_dir_all(d.bundled.join("not-a-map")).unwrap();
        std::fs::write(d.bundled.join("galaxy.json"), "{}").unwrap();

        let mut items = Vec::new();
        list_maps(&d.bundled, "bundled", &mut items);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].folder, "shores");
        assert_eq!(items[0].source, "bundled");
        assert_eq!(items[0].manifest, MANIFEST);
        assert_eq!(items[0].files, ["map.json", "models/tower.glb"]);
    }
}
