//! The `VFS` global: a loose-file backend for the Spring VFS Lua API.
//!
//! Function signatures and the mode-constant string values mirror the engine
//! (`rts/Lua/LuaVFS.cpp`): `Include(name, env?, mode?)`,
//! `LoadFile(name, mode?)`, `FileExists(name, mode?)`,
//! `DirList(dir, pattern?, mode?, recursive?)`, `SubDirs(...)`. The engine
//! searches *archives* by mode; here every read resolves against one root
//! directory, so the mode argument is accepted and ignored.
//!
//! Security: all paths resolve under `root`; any `..` component is rejected.
//! This is the boundary that keeps untrusted (downloaded) map Lua inside the
//! working folder.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use mlua::{Lua, Value, Variadic};

/// VFS mode constants, as the engine pushes them (string values from
/// `LuaVFS.cpp`). Inert in the loose-file backend — present only so config that
/// passes `VFS.MAP` / `VFS.ZIP_FIRST` / ... doesn't get nil.
const MODES: &[(&str, &str)] = &[
    ("RAW", "r"),
    ("MOD", "M"),
    ("GAME", "M"),
    ("MAP", "m"),
    ("BASE", "b"),
    ("MENU", "e"),
    ("ZIP", "Mmeb"),
    ("RAW_FIRST", "rMmeb"),
    ("ZIP_FIRST", "Mmebr"),
    ("RAW_ONLY", "r"),
    ("ZIP_ONLY", "Mmeb"),
];

/// Install the `VFS` global into `lua`, rooted at `root`.
pub fn install(lua: &Lua, root: &Path) -> mlua::Result<()> {
    let vfs = lua.create_table()?;
    for (k, v) in MODES {
        vfs.set(*k, *v)?;
    }

    // VFS.Include(name, env?, mode?) -> evaluate the file, return its result.
    let r = root.to_path_buf();
    vfs.set(
        "Include",
        lua.create_function(move |lua, args: Variadic<Value>| {
            let name = arg_str(&args, 0, "VFS.Include")?;
            let p = resolve(&r, &name).ok_or_else(|| escape_err("VFS.Include", &name))?;
            let src = std::fs::read_to_string(&p)
                .map_err(|e| mlua::Error::RuntimeError(format!("VFS.Include: {name}: {e}")))?;
            // env (args[1]) is ignored; chunks run in the shared sandbox.
            lua.load(&src).set_name(&name).eval::<Value>()
        })?,
    )?;

    // VFS.LoadFile(name, mode?) -> file contents as a string, or nil.
    let r = root.to_path_buf();
    vfs.set(
        "LoadFile",
        lua.create_function(move |_, args: Variadic<Value>| {
            let name = arg_str(&args, 0, "VFS.LoadFile")?;
            Ok(resolve(&r, &name).and_then(|p| std::fs::read_to_string(p).ok()))
        })?,
    )?;

    // VFS.FileExists(name, mode?) -> bool.
    let r = root.to_path_buf();
    vfs.set(
        "FileExists",
        lua.create_function(move |_, args: Variadic<Value>| {
            let name = arg_str(&args, 0, "VFS.FileExists")?;
            Ok(resolve(&r, &name).map(|p| p.is_file()).unwrap_or(false))
        })?,
    )?;

    // VFS.DirList(dir, pattern?, mode?, recursive?) -> array of file paths.
    let r = root.to_path_buf();
    vfs.set(
        "DirList",
        lua.create_function(move |lua, args: Variadic<Value>| {
            let dir = arg_str(&args, 0, "VFS.DirList")?;
            let pattern = opt_str(&args, 1);
            let recursive = opt_bool(&args, 3);
            let files = list(&r, &dir, pattern.as_deref(), recursive, Kind::File);
            lua.create_sequence_from(files)
        })?,
    )?;

    // VFS.SubDirs(dir, pattern?, mode?, recursive?) -> array of directory paths.
    let r = root.to_path_buf();
    vfs.set(
        "SubDirs",
        lua.create_function(move |lua, args: Variadic<Value>| {
            let dir = arg_str(&args, 0, "VFS.SubDirs")?;
            let pattern = opt_str(&args, 1);
            let recursive = opt_bool(&args, 3);
            let dirs = list(&r, &dir, pattern.as_deref(), recursive, Kind::Dir);
            lua.create_sequence_from(dirs)
        })?,
    )?;

    lua.globals().set("VFS", vfs)?;
    Ok(())
}

fn arg_str(args: &Variadic<Value>, i: usize, who: &str) -> mlua::Result<String> {
    match args.get(i) {
        Some(Value::String(s)) => Ok(s.to_str()?.to_owned()),
        _ => Err(mlua::Error::RuntimeError(format!(
            "{who}: expected a string filename"
        ))),
    }
}

fn opt_str(args: &Variadic<Value>, i: usize) -> Option<String> {
    match args.get(i) {
        Some(Value::String(s)) => s.to_str().ok().map(|s| s.to_owned()),
        _ => None,
    }
}

fn opt_bool(args: &Variadic<Value>, i: usize) -> bool {
    matches!(args.get(i), Some(Value::Boolean(true)))
}

fn escape_err(who: &str, name: &str) -> mlua::Error {
    mlua::Error::RuntimeError(format!("{who}: path escapes VFS root: {name}"))
}

/// Resolve a VFS-relative path under `root`, rejecting any `..` traversal. A
/// leading `/` is treated as root-relative (Spring paths are VFS-relative, not
/// absolute filesystem paths). Each segment is spelled the way the directory
/// above it spells it, per [`resolve_case`].
fn resolve(root: &Path, rel: &str) -> Option<PathBuf> {
    let mut p = root.to_path_buf();
    for seg in rel.split(['/', '\\']) {
        match seg {
            "" | "." => continue,
            ".." => return None,
            _ => {
                let found = same_name_ignoring_case(&p, OsStr::new(seg));
                p.push(found.unwrap_or_else(|| OsString::from(seg)));
            }
        }
    }
    Some(p)
}

/// The entry in `dir` that `name` names, ignoring case.
///
/// An exact match wins, so a filesystem holding both spellings gets a stable
/// answer rather than one that depends on the order the directory was read.
fn same_name_ignoring_case(dir: &Path, name: &OsStr) -> Option<OsString> {
    let wanted = name.to_string_lossy().to_lowercase();
    let mut ignoring_case = None;
    for found in std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.file_name())
    {
        if found == name {
            return Some(found);
        }
        if ignoring_case.is_none() && found.to_string_lossy().to_lowercase() == wanted {
            ignoring_case = Some(found);
        }
    }
    ignoring_case
}

/// `root`'s `rel`, spelled the way `root` already spells it (issues #798, #951).
///
/// The engine reads a path case-insensitively. `CDirArchive` keeps the spelling
/// on disk in `files[fid].fileName` and lower-cases only the `lcNameIndex` it
/// looks names up in. `CVFSHandler` lower-cases both what it indexes
/// (`StringToLower(ar->FileName(fid))` in `AddArchive`) and the path it is
/// asked for (`GetNormalizedPath`). Either way, a game asking for
/// `missions/runtime.lua` is handed the `Missions/runtime.lua` it shipped, and
/// the spelling on disk is never what decides. A filesystem that keeps case, which is
/// every Linux one, does not, and neither did this sandbox before #951. So Lua
/// that a real engine runs would fail here, and a folder coilbox wrote into
/// would be a second folder beside the game's own.
///
/// Each component is looked up in the directory above it and kept as written
/// when nothing is there, so a path into a tree that does not exist yet is
/// spelled by the caller. The listing is read on every platform rather than only
/// where case matters, which is what makes the result the same everywhere and so
/// testable on a case-insensitive one.
pub fn resolve_case(root: &Path, rel: &Path) -> PathBuf {
    let mut out = root.to_path_buf();
    for part in rel.iter() {
        match same_name_ignoring_case(&out, part) {
            Some(found) => out.push(found),
            None => out.push(part),
        }
    }
    out
}

enum Kind {
    File,
    Dir,
}

/// List files or subdirectories under `dir` (VFS-relative), optionally
/// recursive, filtered by a simple `*`/`?` wildcard `pattern`. Returns
/// forward-slashed paths. Unreadable/escaping dirs yield `[]`.
///
/// The names come back the way the engine hands them back, not the way the
/// filesystem spells them (issue #964). `CVFSHandler::AddArchive` lower-cases
/// every path into its index (`StringToLower(ar->FileName(fid))`), so
/// `GetFilesInDir` returns lower-cased names, and `CFileHandler::DirList`
/// sorts and `std::unique`s what it collected. Two spellings of one name are
/// one index key and so one entry, which is what a case-sensitive filesystem
/// would otherwise list twice.
///
/// The `dir` the caller asked for is put back on the front verbatim, again as
/// the engine does (`prefix + f` in `InsertVFSFiles`), so only the part below it
/// is the index's to spell.
fn list(root: &Path, dir: &str, pattern: Option<&str>, recursive: bool, kind: Kind) -> Vec<String> {
    let base = match resolve(root, dir) {
        Some(p) => p,
        None => return Vec::new(),
    };
    let mut out = Vec::new();
    walk(&base, &base, pattern, recursive, &kind, &mut out);
    for name in out.iter_mut() {
        *name = name.to_lowercase();
    }
    out.sort();
    out.dedup();
    let prefix = dir_prefix(dir);
    out.into_iter().map(|name| prefix.clone() + &name).collect()
}

/// The `dir` argument as a prefix for each listed name: forward-slashed, and
/// ending in one slash unless it is empty. The engine's rule, from
/// `CFileHandler::InsertVFSFiles`.
fn dir_prefix(dir: &str) -> String {
    let dir = dir.replace('\\', "/");
    if dir.is_empty() || dir.ends_with('/') {
        return dir;
    }
    dir + "/"
}

fn walk(
    base: &Path,
    dir: &Path,
    pattern: Option<&str>,
    recursive: bool,
    kind: &Kind,
    out: &mut Vec<String>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_dir = path.is_dir();
        let name = entry.file_name().to_string_lossy().into_owned();
        let matches = pattern.map(|p| wildcard(p, &name)).unwrap_or(true);
        let want = match kind {
            Kind::File => !is_dir,
            Kind::Dir => is_dir,
        };
        if want && matches {
            if let Some(rel) = rel_str(base, &path) {
                out.push(rel);
            }
        }
        if recursive && is_dir {
            walk(base, &path, pattern, recursive, kind, out);
        }
    }
}

/// Path relative to `base`, with forward slashes (the VFS convention).
fn rel_str(base: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(base).ok()?;
    Some(rel.to_string_lossy().replace('\\', "/"))
}

/// Minimal glob: `*` matches any run, `?` matches one char. Case-insensitive,
/// matching the engine's case-insensitive file lookup. Enough for the `"*.lua"`
/// style patterns Spring config uses.
fn wildcard(pattern: &str, name: &str) -> bool {
    let p: Vec<char> = pattern.to_lowercase().chars().collect();
    let n: Vec<char> = name.to_lowercase().chars().collect();
    matches_at(&p, &n)
}

fn matches_at(p: &[char], n: &[char]) -> bool {
    match p.first() {
        None => n.is_empty(),
        Some('*') => matches_at(&p[1..], n) || (!n.is_empty() && matches_at(p, &n[1..])),
        Some('?') => !n.is_empty() && matches_at(&p[1..], &n[1..]),
        Some(&c) => n.first() == Some(&c) && matches_at(&p[1..], &n[1..]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The fixture tree, which spells its folders and files in lower case.
    fn fixtures() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
    }

    /// What the engine would have read. Asserted as the path rather than as a
    /// successful read, because a case-insensitive filesystem would answer the
    /// read either way and prove nothing.
    #[test]
    fn a_path_resolves_to_the_casing_on_disk() {
        let root = fixtures();
        assert_eq!(
            resolve(&root, "WITHINCLUDE/MapInfo.lua"),
            Some(root.join("withinclude/mapinfo.lua"))
        );
        assert_eq!(
            resolve_case(&root, Path::new("WithInclude/MAPINFO.LUA")),
            root.join("withinclude/mapinfo.lua")
        );
    }

    /// A name nothing on disk answers is kept as the caller wrote it, so a read
    /// fails as a missing file rather than as something else.
    #[test]
    fn a_path_to_nothing_is_kept_as_written() {
        let root = fixtures();
        assert_eq!(
            resolve(&root, "withinclude/NoSuchFile.lua"),
            Some(root.join("withinclude/NoSuchFile.lua"))
        );
    }

    /// The root boundary is unchanged by the lookup: a segment is only ever
    /// matched against what is in the directory above it.
    #[test]
    fn traversal_is_still_refused() {
        assert_eq!(resolve(&fixtures(), "withinclude/../mapinfo.lua"), None);
    }

    /// A listing is spelled by the caller down to the directory asked for, and
    /// by the engine's index below it (issue #964).
    #[test]
    fn a_listing_keeps_the_asked_for_dir_and_lower_cases_the_rest() {
        let root = fixtures();
        assert_eq!(
            list(&root, "WithInclude", None, false, Kind::File),
            vec!["WithInclude/mapinfo.lua"]
        );
        assert_eq!(
            list(&root, "WithInclude/", None, true, Kind::File),
            vec!["WithInclude/mapinfo.lua", "WithInclude/sub/extra.lua"]
        );
        assert_eq!(
            list(&root, "WithInclude", None, false, Kind::Dir),
            vec!["WithInclude/sub"]
        );
    }

    /// Listing the root itself names each entry bare, because there is no dir
    /// to put back on the front.
    #[test]
    fn listing_the_root_names_entries_bare() {
        assert_eq!(
            list(&fixtures(), "", None, false, Kind::Dir),
            vec!["mission", "modinfo", "selfcontained", "withinclude"]
        );
    }

    /// Two spellings of one name are one entry, because they are one key in
    /// the engine's index.
    ///
    /// Real only on a case-sensitive filesystem, where both directories exist.
    /// On a case-insensitive one the second `create_dir_all` lands in the
    /// first, and the same answer is expected for the simpler reason.
    #[test]
    fn two_spellings_of_one_folder_are_listed_once() {
        let tmp = tempfile::tempdir().expect("temp dir");
        let root = tmp.path();
        for spelling in ["LuaRules/Gadgets", "luarules/gadgets"] {
            std::fs::create_dir_all(root.join(spelling)).expect("mkdir");
            std::fs::write(root.join(spelling).join("unit_ai.lua"), "").expect("write");
        }
        assert_eq!(
            list(root, "", None, true, Kind::File),
            vec!["luarules/gadgets/unit_ai.lua"]
        );
        assert_eq!(
            list(root, "", None, true, Kind::Dir),
            vec!["luarules", "luarules/gadgets"]
        );
    }

    /// The wildcard still filters, and still filters on the name as written
    /// rather than on the key, because it is matched case-insensitively either
    /// way.
    #[test]
    fn a_pattern_still_filters() {
        let root = fixtures();
        assert_eq!(
            list(&root, "withinclude", Some("*.LUA"), false, Kind::File),
            vec!["withinclude/mapinfo.lua"]
        );
        assert!(list(&root, "withinclude", Some("*.txt"), false, Kind::File).is_empty());
    }
}
