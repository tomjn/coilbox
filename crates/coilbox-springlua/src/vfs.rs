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
/// absolute filesystem paths).
fn resolve(root: &Path, rel: &str) -> Option<PathBuf> {
    let mut p = root.to_path_buf();
    for seg in rel.split(['/', '\\']) {
        match seg {
            "" | "." => continue,
            ".." => return None,
            _ => p.push(seg),
        }
    }
    Some(p)
}

enum Kind {
    File,
    Dir,
}

/// List files or subdirectories under `dir` (VFS-relative), optionally
/// recursive, filtered by a simple `*`/`?` wildcard `pattern`. Returns
/// VFS-relative, forward-slashed paths. Unreadable/escaping dirs yield `[]`.
fn list(root: &Path, dir: &str, pattern: Option<&str>, recursive: bool, kind: Kind) -> Vec<String> {
    let base = match resolve(root, dir) {
        Some(p) => p,
        None => return Vec::new(),
    };
    let mut out = Vec::new();
    walk(root, &base, pattern, recursive, &kind, &mut out);
    out
}

fn walk(
    root: &Path,
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
            if let Some(rel) = rel_str(root, &path) {
                out.push(rel);
            }
        }
        if recursive && is_dir {
            walk(root, &path, pattern, recursive, kind, out);
        }
    }
}

/// Path relative to `root`, with forward slashes (the VFS convention).
fn rel_str(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
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
