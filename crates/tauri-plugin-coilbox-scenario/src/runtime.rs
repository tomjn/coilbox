//! Installing the mission runtime into a loose `.sdd` game.
//!
//! The runtime is coilbox-authored Lua kept in this repo under
//! `lua/mission-runtime/` and shipped as a bundle resource. A game adopts it by
//! vendoring three trees, `luarules/`, `luaui/` and `missions/`, kept in step
//! with a coilbox version (see that folder's README). This module is the
//! writing half of that contract: it copies those trees into a game folder and
//! reads the version marker back out through the same `VFS.Include` the gadget
//! will use, so what coilbox reports is what the engine will load.
//!
//! Only a loose game can be written to. A packaged `.sd7`/`.sdz` is read-only,
//! and gets the test mutator instead (issue #754).

use coilbox_springlua::{resolve_case, SpringLua};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

/// The trees a game vendors. `tests/` and `README.md` sit outside them on
/// purpose and are never installed.
const VENDORED: [&str; 3] = ["luarules", "luaui", "missions"];

/// The version marker and capability table, relative to the game root.
pub const MARKER: &str = "missions/runtime.lua";

/// A game's own condition and action types, relative to the game root. The
/// game's file, never coilbox's: it is the one thing under `missions/` that an
/// install does not write and an update does not touch.
pub const EXTENSIONS: &str = "missions/extensions.lua";

/// Where the runtime can sit inside the resource directory, in the order we take
/// them. The Windows installer moves it into `.coilbox\resources` so the install
/// folder shows little more than the executable. Every other platform leaves it at
/// the top of the resource directory. The last two are what older bundles made of
/// the `../lua/mission-runtime` resource entry, and answer for an install that
/// predates this layout.
const CANDIDATES: [&str; 4] = [
    ".coilbox/resources/mission-runtime",
    "mission-runtime",
    "lua/mission-runtime",
    "_up_/lua/mission-runtime",
];

/// Pure core of [`runtime_dir`]: the first [`CANDIDATES`] entry under
/// `resource_dir` that is a directory.
fn bundled_runtime_dir(resource_dir: &Path, is_dir: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    CANDIDATES
        .into_iter()
        .map(|rel| resource_dir.join(rel))
        .find(|path| is_dir(path))
}

/// Where the bundled runtime lives.
///
/// `bundle.resources` is assembled by `tauri build` and the Windows installer
/// moves it afterwards, so the candidates are probed rather than assumed. Under
/// `tauri dev` there are no resources beside the binary at all, hence the
/// source-tree fallback in debug builds.
pub fn runtime_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let bundled = app
        .path()
        .resource_dir()
        .ok()
        .and_then(|dir| bundled_runtime_dir(&dir, |path| path.is_dir()));
    if bundled.is_some() {
        return bundled;
    }
    if cfg!(debug_assertions) {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../lua/mission-runtime")
            .canonicalize()
            .ok()
            .filter(|dir| dir.is_dir());
    }
    None
}

/// Every file under `root`'s vendored trees, relative to `root` and sorted.
///
/// The trees are found under the casing `root` spells them with, so a game's own
/// `LuaRules/` is walked rather than missed, and the paths that come back are
/// the ones to read and remove.
///
/// Dot-files are skipped: the source tree is a working copy, and a `.DS_Store`
/// is not part of what a game vendors.
fn vendored_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for tree in VENDORED {
        let dir = resolve_case(root, Path::new(tree));
        let name = dir.file_name().unwrap_or_else(|| OsStr::new(tree));
        walk(&dir, Path::new(name), &mut files);
    }
    files.sort();
    files
}

fn walk(dir: &Path, rel: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let path = entry.path();
        let child = rel.join(&name);
        if path.is_dir() {
            walk(&path, &child, files);
        } else {
            files.push(child);
        }
    }
}

/// One relative path as a comparable key: forward slashes, lower case.
///
/// Case is dropped because a game folder's casing is its own: an install writes
/// into the game's `LuaRules/Gadgets/` (see [`resolve_case`]) and has to
/// recognise the file it just wrote when it walks back over the tree. The engine
/// agrees, keying an archive's file index lower case.
fn key(rel: &Path) -> String {
    rel.to_string_lossy().replace('\\', "/").to_lowercase()
}

/// Whether an installed file is the runtime's to remove when a newer runtime no
/// longer ships it.
///
/// Coilbox owns `luarules/mission_runtime/` outright, and everything else it
/// vendors is named `coilbox_*`. Anything else under the three trees belongs to
/// the game (its own gadgets, and the compiled missions coilbox writes at launch
/// time) and is never touched. Without this a gadget dropped between runtime
/// versions would keep loading in every game that had installed it.
fn runtime_owned(key: &str) -> bool {
    key.starts_with("luarules/mission_runtime/")
        || key
            .rsplit('/')
            .next()
            .is_some_and(|name| name.starts_with("coilbox_"))
}

/// Copy the vendored trees from `src` into the game at `dest`, then drop what an
/// older install left behind. Returns the files written, relative to `dest`.
///
/// Files are copied one by one rather than the trees replaced, because `dest`'s
/// `luarules/` and `missions/` are shared with the game. Re-running is therefore
/// safe: the same files are overwritten with the same contents.
///
/// Every destination is spelled the way `dest` already spells it, so a game's
/// own `LuaRules/` takes the runtime rather than a second `luarules/` growing
/// beside it on a case-sensitive filesystem (issue #798).
pub fn install(src: &Path, dest: &Path) -> Result<Vec<String>, String> {
    let files = vendored_files(src);
    if files.is_empty() {
        return Err(format!(
            "no runtime files to install from {}",
            src.display()
        ));
    }
    let mut written = Vec::new();
    for rel in &files {
        let to = resolve_case(dest, rel);
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
        }
        std::fs::copy(src.join(rel), &to)
            .map_err(|e| format!("could not write {}: {e}", to.display()))?;
        written.push(key(rel));
    }
    for rel in vendored_files(dest) {
        let key = key(&rel);
        if runtime_owned(&key) && !written.contains(&key) {
            let stale = dest.join(&rel);
            std::fs::remove_file(&stale)
                .map_err(|e| format!("could not remove {}: {e}", stale.display()))?;
        }
    }
    Ok(written)
}

/// Every directory in `root` that is a spelling of the vendored tree `tree`,
/// sorted.
///
/// Usually one, and on Windows and macOS never more than one. A Linux game that
/// coilbox installed into before issue #798 has two: the `LuaRules/` the game
/// ships and the `luarules/` coilbox made beside it.
fn spellings_of(root: &Path, tree: &str) -> Vec<OsString> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut found: Vec<OsString> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name())
        .filter(|name| name.to_string_lossy().to_lowercase() == tree)
        .collect();
    found.sort();
    found
}

/// The spelling of `tree` the runtime should live under, given every spelling
/// `root` holds.
///
/// The game's own, wherever that can be told apart: a tree carrying a file that
/// is neither the runtime's nor one it used to ship is a tree the game keeps its
/// own content in, and that is the one a maintainer commits and a coilbox update
/// should land in. Where that says nothing, or says both, the answer is the one
/// an install already writes to, so nothing moves for no reason.
fn tree_to_keep(root: &Path, tree: &str, spellings: &[OsString], shipped: &[String]) -> OsString {
    let games: Vec<&OsString> = spellings
        .iter()
        .filter(|spelling| {
            let mut files = Vec::new();
            walk(&root.join(spelling), Path::new(spelling), &mut files);
            files.iter().any(|rel| {
                let key = key(rel);
                !runtime_owned(&key) && !shipped.contains(&key)
            })
        })
        .collect();
    if let [only] = games[..] {
        return only.clone();
    }
    let exact = OsString::from(tree);
    if spellings.contains(&exact) {
        return exact;
    }
    spellings
        .first()
        .cloned()
        .unwrap_or_else(|| OsString::from(tree))
}

/// The runtime files a game holds under a spelling of a vendored tree other than
/// the one it keeps, relative to `root` and sorted (issue #950).
///
/// A Linux game with both `LuaRules/` and `luarules/` has the runtime in one and
/// whatever an older coilbox left in the other. The engine lower-cases every path
/// into one index, so the two trees are one folder to it and the same file under
/// both spellings loads exactly once, from whichever the archive was read in
/// first. A stale copy is therefore not untidiness: it is a file the engine may
/// load in place of the one coilbox just wrote, and the install's own prune walks
/// one spelling so it can never reach it.
///
/// Only files coilbox put there are listed: what this runtime ships, and what an
/// older one shipped ([`runtime_owned`]). The game's own gadgets, widgets and
/// missions are never in the list, whichever tree they sit in.
pub fn duplicates(src: &Path, root: &Path) -> Vec<PathBuf> {
    let shipped: Vec<String> = vendored_files(src).iter().map(|rel| key(rel)).collect();
    let mut out = Vec::new();
    for spelling in losing_trees(root, &shipped) {
        let mut files = Vec::new();
        walk(&root.join(&spelling), Path::new(&spelling), &mut files);
        for rel in files {
            let key = key(&rel);
            if shipped.contains(&key) || runtime_owned(&key) {
                out.push(rel);
            }
        }
    }
    out.sort();
    out
}

/// The spellings of a vendored tree that `root` is not keeping the runtime in.
/// Empty for a game with one spelling of each, which is every game on Windows
/// and macOS and every Linux game coilbox has not installed into twice.
fn losing_trees(root: &Path, shipped: &[String]) -> Vec<OsString> {
    let mut out = Vec::new();
    for tree in VENDORED {
        let spellings = spellings_of(root, tree);
        if spellings.len() < 2 {
            continue;
        }
        let keep = tree_to_keep(root, tree, &spellings, shipped);
        out.extend(spellings.into_iter().filter(|s| *s != keep));
    }
    out
}

/// Remove `dir` and everything under it that is now empty, deepest first.
///
/// `remove_dir` refuses a directory with anything in it, so a tree still holding
/// the game's own files stays and only the folders coilbox emptied go.
fn prune_empty_dirs(dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                prune_empty_dirs(&path);
            }
        }
    }
    let _ = std::fs::remove_dir(dir);
}

/// Put a game holding two spellings of a vendored tree back together, and say
/// what went (issue #950).
///
/// `apply` false lists [`duplicates`] and touches nothing, so a player sees the
/// files before they go. `apply` true removes them, drops the folders that
/// leaves empty, and installs again, because the tree that is left may be the
/// one holding the older copy.
///
/// This is the one place coilbox removes a file from a folder it did not
/// necessarily write, which is why it is an explicit act rather than something
/// an install does on its way past.
pub fn consolidate(src: &Path, root: &Path, apply: bool) -> Result<Vec<String>, String> {
    let found = duplicates(src, root);
    let removed: Vec<String> = found
        .iter()
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        .collect();
    if !apply || found.is_empty() {
        return Ok(removed);
    }
    // Read before anything is removed, because emptying a tree is what changes
    // the answer, and the folders to drop are the ones that lost the file.
    let shipped: Vec<String> = vendored_files(src).iter().map(|rel| key(rel)).collect();
    let losers = losing_trees(root, &shipped);
    for rel in &found {
        let path = root.join(rel);
        std::fs::remove_file(&path)
            .map_err(|e| format!("could not remove {}: {e}", path.display()))?;
    }
    for spelling in losers {
        prune_empty_dirs(&root.join(spelling));
    }
    install(src, root)?;
    Ok(removed)
}

/// Unwrap Lua's `[string "name"]:` chunk markers.
///
/// A marker naming `chunk` becomes `line `, because the caller has already named
/// that file. Any other becomes the bare name, so an error raised in an included
/// sibling still says which file it came from.
fn unwrap_chunk_names(line: &str, chunk: &str) -> String {
    const OPEN: &str = "[string \"";
    const CLOSE: &str = "\"]:";
    let mut out = String::new();
    let mut rest = line;
    while let Some(start) = rest.find(OPEN) {
        let (before, marker) = rest.split_at(start);
        out.push_str(before);
        let body = &marker[OPEN.len()..];
        let Some(end) = body.find(CLOSE) else {
            out.push_str(marker);
            return out;
        };
        let name = &body[..end];
        if name == chunk {
            out.push_str("line ");
        } else {
            out.push_str(name);
            out.push(':');
        }
        rest = &body[end + CLOSE.len()..];
    }
    out.push_str(rest);
    out
}

/// A Lua error as a player should read it (issue #915).
///
/// The sandbox reports a bad file as `syntax error: [string
/// "missions/runtime.lua"]:3: unexpected symbol near ','` followed by a stack
/// traceback whose only frame is coilbox's own `VFS.Include` call. The file and
/// the line are what a game author can act on, so the traceback is dropped and
/// the chunk markers unwrapped. The raw error goes to stderr for whoever is
/// working on the sandbox.
fn tidy_lua_error(raw: &str, chunk: &str) -> String {
    let head = raw.split("stack traceback:").next().unwrap_or(raw);
    let first = head
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let tidied = unwrap_chunk_names(first, chunk);
    if tidied.is_empty() {
        raw.trim().to_string()
    } else {
        tidied
    }
}

/// Read one of the runtime's data files out of a game, through the gadget's own
/// code path: a sandboxed Spring Lua VM rooted at the archive, and
/// `VFS.Include`. Both files are data with no globals and no engine calls, so
/// what comes back here is what the engine will read.
fn read_data(root: &Path, rel: &str) -> Result<serde_json::Value, String> {
    // Both files are optional, and both callers treat a missing one as an
    // ordinary answer: nearly every game declares no types of its own, and a
    // game that never adopted the runtime has no marker. Asking the sandbox for
    // a file that is not there turns that ordinary answer into a Lua error and
    // a line on stderr, which buries the games that do have something wrong.
    // The path resolves against the casing on disk, as the engine does (issue
    // #951) and as `marker_present` does, so a game's own `Missions/` answers a
    // read of `missions/`.
    let path = resolve_case(root, Path::new(rel));
    if !path.is_file() {
        return Err(format!("{rel} is not there"));
    }
    let lua = SpringLua::new(root).map_err(|e| format!("could not start the Lua sandbox: {e}"))?;
    lua.include_value(rel).map_err(|e| {
        let raw = e.to_string();
        eprintln!("coilbox-scenario: {} would not load: {raw}", path.display());
        format!("could not read {rel}: {}", tidy_lua_error(&raw, rel))
    })
}

/// Read a game's installed version marker. An error means no runtime is
/// installed, or the one there is will not load. [`marker_present`] tells the
/// two apart.
pub fn read_marker(root: &Path) -> Result<serde_json::Value, String> {
    read_data(root, MARKER)
}

/// Whether the game has a marker file at all, so a marker that will not load
/// can be told from a game that never adopted the runtime.
///
/// The path is the one an install writes, resolved against the game's own
/// casing, which is the only way a marker gets there.
pub fn marker_present(root: &Path) -> bool {
    resolve_case(root, Path::new(MARKER)).is_file()
}

/// Read the condition and action types a game declares for itself. An error
/// means the game declares none, which is nearly every game.
pub fn read_extensions(root: &Path) -> Result<serde_json::Value, String> {
    read_data(root, EXTENSIONS)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stand-in for the shipped runtime: the three trees, plus the files that
    /// sit outside them and must not be installed.
    fn source_tree() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        for (rel, body) in [
            (
                "missions/runtime.lua",
                "return { version = 1, conditions = { \"unit_dead\" }, actions = {} }",
            ),
            ("luarules/gadgets/coilbox_mission_runtime.lua", "-- gadget"),
            ("luarules/mission_runtime/coilbox_start.lua", "-- start"),
            ("luaui/widgets/coilbox_objectives.lua", "-- widget"),
            ("tests/gate_test.lua", "-- not vendored"),
            ("README.md", "not vendored"),
        ] {
            let path = root.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).expect("mkdir");
            std::fs::write(path, body).expect("write");
        }
        std::fs::write(root.join("missions/.DS_Store"), "junk").expect("write");
        dir
    }

    #[test]
    fn the_runtime_is_found_where_the_windows_installer_tucks_it() {
        let res = Path::new("C:/Program Files/Coilbox");
        let tucked = res.join(".coilbox/resources/mission-runtime");
        assert_eq!(
            bundled_runtime_dir(res, |path| path == tucked),
            Some(tucked)
        );
    }

    #[test]
    fn a_bundle_that_kept_its_old_layout_still_answers() {
        let res = Path::new("/app/resources");
        let old = res.join("_up_/lua/mission-runtime");
        assert_eq!(bundled_runtime_dir(res, |path| path == old), Some(old));
    }

    #[test]
    fn no_runtime_beside_the_binary_is_no_runtime() {
        assert_eq!(bundled_runtime_dir(Path::new("/app"), |_| false), None);
    }

    #[test]
    fn installs_only_the_vendored_trees() {
        let src = source_tree();
        let game = tempfile::tempdir().expect("tempdir");

        let written = install(src.path(), game.path()).expect("install");

        assert_eq!(
            written,
            vec![
                "luarules/gadgets/coilbox_mission_runtime.lua",
                "luarules/mission_runtime/coilbox_start.lua",
                "luaui/widgets/coilbox_objectives.lua",
                "missions/runtime.lua",
            ]
        );
        assert!(!game.path().join("tests").exists());
        assert!(!game.path().join("README.md").exists());
        assert!(!game.path().join("missions/.DS_Store").exists());
    }

    #[test]
    fn the_marker_reads_back_through_the_vfs() {
        let src = source_tree();
        let game = tempfile::tempdir().expect("tempdir");

        install(src.path(), game.path()).expect("install");
        let marker = read_marker(game.path()).expect("marker");

        assert_eq!(marker["version"], 1);
        assert_eq!(marker["conditions"], serde_json::json!(["unit_dead"]));
    }

    /// A game's own types come back as the declaration wrote them: lists stay
    /// lists, so the order the game declared its parameters in is the order the
    /// editor draws them.
    #[test]
    fn a_games_own_types_read_back_through_the_vfs() {
        let game = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(game.path().join("missions")).expect("mkdir");
        std::fs::write(
            game.path().join("missions/extensions.lua"),
            r#"return {
                handler = "luarules/mission_extensions/demo.lua",
                conditions = {
                    {
                        type = "demo_ready",
                        label = "Ready",
                        params = {
                            { name = "team", kind = "teamId" },
                            { name = "amount", kind = "number", optional = true },
                        },
                    },
                },
            }"#,
        )
        .expect("write");

        let declared = read_extensions(game.path()).expect("extensions");

        assert_eq!(declared["handler"], "luarules/mission_extensions/demo.lua");
        assert_eq!(declared["conditions"][0]["type"], "demo_ready");
        assert_eq!(declared["conditions"][0]["params"][0]["name"], "team");
        assert_eq!(declared["conditions"][0]["params"][1]["optional"], true);
    }

    #[test]
    fn a_game_that_declares_no_types_of_its_own_has_no_declaration() {
        let src = source_tree();
        let game = tempfile::tempdir().expect("tempdir");
        install(src.path(), game.path()).expect("install");
        assert!(read_extensions(game.path()).is_err());
    }

    /// A file that was never there is absent, not broken. Nearly every game
    /// declares no types of its own, and an unadopted game has no marker, so
    /// both must read as "not there" rather than as a sandbox failure. The
    /// stderr line the sandbox failure earns sits behind the same check.
    #[test]
    fn a_file_that_is_not_there_reads_as_absent_rather_than_broken() {
        let game = tempfile::tempdir().expect("tempdir");

        assert_eq!(
            read_extensions(game.path()).expect_err("no declaration"),
            "missions/extensions.lua is not there"
        );
        assert_eq!(
            read_marker(game.path()).expect_err("no marker"),
            "missions/runtime.lua is not there"
        );
    }

    #[test]
    fn a_game_with_no_runtime_has_no_marker() {
        let game = tempfile::tempdir().expect("tempdir");
        assert!(read_marker(game.path()).is_err());
        assert!(!marker_present(game.path()));
    }

    /// The two failures a caller has to tell apart: a marker that is not there,
    /// and one that is there and will not load.
    #[test]
    fn a_marker_that_will_not_load_is_still_present() {
        let game = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(game.path().join("missions")).expect("mkdir");
        std::fs::write(game.path().join(MARKER), "return {").expect("write");

        assert!(read_marker(game.path()).is_err());
        assert!(marker_present(game.path()));
    }

    /// What a player is shown for a broken marker: the line and what is wrong
    /// with it, and none of the sandbox's own frames (issue #915).
    #[test]
    fn a_broken_marker_reads_as_a_line_and_a_reason() {
        let game = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(game.path().join("missions")).expect("mkdir");
        std::fs::write(game.path().join(MARKER), "return {\n  version = 1,\n  ,\n}")
            .expect("write");

        let message = read_marker(game.path()).expect_err("should not load");

        assert!(!message.contains("stack traceback"), "{message}");
        assert!(!message.contains("[string"), "{message}");
        assert!(!message.contains("VFS.Include"), "{message}");
        assert!(
            message.starts_with("could not read missions/runtime.lua: "),
            "{message}"
        );
        assert!(message.contains("line 3:"), "{message}");
    }

    #[test]
    fn tidying_drops_the_traceback_and_names_the_line() {
        let raw = "syntax error: [string \"missions/runtime.lua\"]:3: unexpected symbol near ','\nstack traceback:\n\t[C]: in function 'VFS.Include'";
        assert_eq!(
            tidy_lua_error(raw, "missions/runtime.lua"),
            "syntax error: line 3: unexpected symbol near ','"
        );
    }

    /// An error raised in a file the marker included keeps its own name, because
    /// that is the file the author has to go and fix.
    #[test]
    fn tidying_keeps_the_name_of_another_file() {
        let raw = "runtime error: [string \"missions/shared.lua\"]:7: attempt to index a nil value";
        assert_eq!(
            tidy_lua_error(raw, "missions/runtime.lua"),
            "runtime error: missions/shared.lua:7: attempt to index a nil value"
        );
    }

    /// An error with no chunk marker at all (a VFS read failure, say) is passed
    /// through as it was written.
    #[test]
    fn tidying_leaves_a_plain_message_alone() {
        assert_eq!(
            tidy_lua_error(
                "VFS.Include: missions/runtime.lua: No such file or directory",
                "missions/runtime.lua"
            ),
            "VFS.Include: missions/runtime.lua: No such file or directory"
        );
        assert_eq!(tidy_lua_error("", "missions/runtime.lua"), "");
    }

    #[test]
    fn installing_twice_leaves_the_same_files() {
        let src = source_tree();
        let game = tempfile::tempdir().expect("tempdir");

        let first = install(src.path(), game.path()).expect("first install");
        let second = install(src.path(), game.path()).expect("second install");

        assert_eq!(first, second);
        assert_eq!(read_marker(game.path()).expect("marker")["version"], 1);
    }

    #[test]
    fn an_update_drops_a_gadget_the_new_runtime_no_longer_ships() {
        let src = source_tree();
        let game = tempfile::tempdir().expect("tempdir");
        install(src.path(), game.path()).expect("install");
        // Left by an older runtime, and by the game itself.
        let stale = game.path().join("luarules/gadgets/coilbox_old_thing.lua");
        std::fs::write(&stale, "-- from runtime 0").expect("write");
        let theirs = game.path().join("luarules/gadgets/game_own_gadget.lua");
        std::fs::write(&theirs, "-- the game's").expect("write");
        let mission = game.path().join("missions/demo/mission.lua");
        std::fs::create_dir_all(mission.parent().unwrap()).expect("mkdir");
        std::fs::write(&mission, "return {}").expect("write");

        install(src.path(), game.path()).expect("update");

        assert!(!stale.exists());
        assert!(theirs.exists());
        assert!(mission.exists());
    }

    #[test]
    fn an_empty_source_is_an_error_rather_than_an_empty_install() {
        let src = tempfile::tempdir().expect("tempdir");
        let game = tempfile::tempdir().expect("tempdir");
        assert!(install(src.path(), game.path()).is_err());
    }

    #[test]
    fn only_coilbox_files_and_the_runtime_folder_are_ours_to_remove() {
        assert!(runtime_owned("luarules/gadgets/coilbox_x.lua"));
        assert!(runtime_owned("luarules/mission_runtime/helper.lua"));
        assert!(!runtime_owned("luarules/gadgets/their_gadget.lua"));
        assert!(!runtime_owned("missions/runtime.lua"));
        assert!(!runtime_owned("missions/demo/mission.lua"));
    }

    #[test]
    fn a_game_folder_keeps_its_own_casing() {
        assert_eq!(
            key(Path::new("LuaRules/Gadgets/Coilbox_X.lua")),
            key(Path::new("luarules/gadgets/coilbox_x.lua"))
        );
    }

    /// Games spell it `LuaRules/Gadgets/`. The install writes into the game's own
    /// spelling, and the prune has to recognise the file it just wrote.
    #[test]
    fn an_install_into_a_games_own_luarules_casing_survives_the_prune() {
        let src = source_tree();
        let game = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(game.path().join("LuaRules/Gadgets")).expect("mkdir");

        install(src.path(), game.path()).expect("install");
        install(src.path(), game.path()).expect("update");

        let installed: Vec<String> = vendored_files(game.path())
            .iter()
            .map(|rel| key(rel))
            .collect();
        assert!(installed.contains(&"luarules/gadgets/coilbox_mission_runtime.lua".to_string()));
    }

    /// Every destination follows the casing already on disk (issue #798). On a
    /// case-sensitive filesystem that is what keeps the install out of a second
    /// `luarules/` beside the game's own `LuaRules/`. Here the two are one
    /// folder, so what is asserted is the path rather than the outcome of
    /// writing to it.
    #[test]
    fn a_destination_follows_the_casing_already_on_disk() {
        let game = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(game.path().join("LuaRules/Gadgets")).expect("mkdir");
        std::fs::create_dir_all(game.path().join("Missions")).expect("mkdir");

        assert_eq!(
            resolve_case(
                game.path(),
                Path::new("luarules/gadgets/coilbox_mission_runtime.lua")
            ),
            game.path()
                .join("LuaRules/Gadgets/coilbox_mission_runtime.lua")
        );
        assert_eq!(
            resolve_case(game.path(), Path::new(MARKER)),
            game.path().join("Missions/runtime.lua")
        );
        // A tree the game does not have is coilbox's to spell.
        assert_eq!(
            resolve_case(
                game.path(),
                Path::new("luaui/widgets/coilbox_objectives.lua")
            ),
            game.path().join("luaui/widgets/coilbox_objectives.lua")
        );
        // So is a folder inside one it does have.
        assert_eq!(
            resolve_case(game.path(), Path::new("luarules/mission_runtime/x.lua")),
            game.path().join("LuaRules/mission_runtime/x.lua")
        );
    }

    /// A filesystem already holding both spellings keeps the one coilbox wrote,
    /// rather than starting a third tree beside the two already there.
    #[test]
    fn an_exact_match_wins_over_one_that_only_differs_in_case() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(dir.path().join("LuaRules")).expect("mkdir");
        // A case-insensitive filesystem cannot hold the second one, and there
        // this arm is unreachable, so the assertion is skipped rather than made
        // to pass for the wrong reason.
        if std::fs::create_dir(dir.path().join("luarules")).is_err() {
            return;
        }
        // Both spellings, because the directory listing can hand them back in
        // either order and only the exact match can satisfy both.
        assert_eq!(
            resolve_case(dir.path(), Path::new("luarules")),
            dir.path().join("luarules")
        );
        assert_eq!(
            resolve_case(dir.path(), Path::new("LuaRules")),
            dir.path().join("LuaRules")
        );
    }

    /// A game holding both spellings of a tree, as a Linux player who installed
    /// the runtime before issue #798 has it: the game's own `LuaRules/` and
    /// `Missions/`, and beside them the `luarules/` and `missions/` an older
    /// coilbox wrote.
    ///
    /// `None` on a filesystem that cannot hold two spellings at once, which is
    /// every Windows and macOS one and where this situation cannot arise.
    /// Skipped rather than made to pass for the wrong reason, so proving it takes
    /// a case-sensitive volume.
    fn game_with_two_spellings() -> Option<tempfile::TempDir> {
        let game = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(game.path().join("LuaRules/Gadgets")).expect("mkdir");
        if std::fs::create_dir(game.path().join("luarules")).is_err() {
            return None;
        }
        for (rel, body) in [
            // The game's own, in the game's own spelling.
            ("LuaRules/Gadgets/game_end.lua", "-- the game's"),
            ("Missions/first/mission.lua", "return {}"),
            // A file an older runtime shipped and this one does not, left in the
            // tree the install no longer writes to. This is the one issue #950
            // measured surviving an update.
            ("LuaRules/mission_runtime/coilbox_old_thing.lua", "-- old"),
            // And what an older coilbox wrote beside the game's trees.
            ("luarules/gadgets/coilbox_mission_runtime.lua", "-- old"),
            ("luarules/mission_runtime/coilbox_start.lua", "-- old"),
            ("missions/runtime.lua", "return { version = 0 }"),
        ] {
            let path = game.path().join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).expect("mkdir");
            std::fs::write(path, body).expect("write");
        }
        Some(game)
    }

    /// A game with one spelling of each tree has nothing to put back together,
    /// which is every game on Windows and macOS and every Linux game coilbox has
    /// not installed into twice.
    #[test]
    fn a_game_with_one_spelling_of_each_tree_has_no_duplicates() {
        let src = source_tree();
        let game = tempfile::tempdir().expect("tempdir");
        install(src.path(), game.path()).expect("install");

        assert!(duplicates(src.path(), game.path()).is_empty());
        assert!(consolidate(src.path(), game.path(), true)
            .expect("consolidate")
            .is_empty());
        assert_eq!(read_marker(game.path()).expect("marker")["version"], 1);
    }

    /// What a preview shows: the runtime's files under the spelling the game
    /// does not keep, and nothing of the game's own.
    #[test]
    fn a_preview_names_the_runtime_files_under_the_other_spelling() {
        let Some(game) = game_with_two_spellings() else {
            return;
        };
        let src = source_tree();

        let found: Vec<String> = duplicates(src.path(), game.path())
            .iter()
            .map(|rel| rel.to_string_lossy().into_owned())
            .collect();

        assert_eq!(
            found,
            vec![
                "luarules/gadgets/coilbox_mission_runtime.lua",
                "luarules/mission_runtime/coilbox_start.lua",
                "missions/runtime.lua",
            ]
        );
        // A dry run is exactly that.
        assert_eq!(
            consolidate(src.path(), game.path(), false).expect("dry run"),
            found
        );
        assert!(game
            .path()
            .join("luarules/gadgets/coilbox_mission_runtime.lua")
            .is_file());
    }

    /// Consolidating leaves the runtime in the game's own trees, takes the
    /// folders an older coilbox made beside them, and leaves the game's own files
    /// where they were.
    #[test]
    fn consolidating_puts_the_runtime_in_the_games_own_trees() {
        let Some(game) = game_with_two_spellings() else {
            return;
        };
        let src = source_tree();

        let removed = consolidate(src.path(), game.path(), true).expect("consolidate");

        assert_eq!(removed.len(), 3);
        assert!(!game.path().join("luarules").exists());
        assert!(!game.path().join("missions").exists());
        assert!(game
            .path()
            .join("LuaRules/Gadgets/coilbox_mission_runtime.lua")
            .is_file());
        assert!(game.path().join("Missions/runtime.lua").is_file());
        // The game's own, untouched.
        assert!(game.path().join("LuaRules/Gadgets/game_end.lua").is_file());
        assert!(game.path().join("Missions/first/mission.lua").is_file());
        // And what the engine will read out of the game afterwards.
        assert_eq!(read_marker(game.path()).expect("marker")["version"], 1);
    }

    /// The measurement issue #950 was filed on: a stale runtime file in the tree
    /// the install does not write to survives every update, because the prune
    /// walks one spelling and can never reach the other. It goes here.
    #[test]
    fn a_stale_file_the_install_cannot_reach_is_taken() {
        let Some(game) = game_with_two_spellings() else {
            return;
        };
        let src = source_tree();
        let stale = game
            .path()
            .join("LuaRules/mission_runtime/coilbox_old_thing.lua");

        install(src.path(), game.path()).expect("update");
        assert!(stale.is_file(), "an update cannot reach it");

        consolidate(src.path(), game.path(), true).expect("consolidate");

        assert!(!stale.exists());
        // Nothing is left under either spelling twice.
        assert!(duplicates(src.path(), game.path()).is_empty());
    }

    /// Consolidating twice is the same as consolidating once: the tree the
    /// runtime landed in is the one the next install writes to.
    #[test]
    fn consolidating_twice_changes_nothing_the_second_time() {
        let Some(game) = game_with_two_spellings() else {
            return;
        };
        let src = source_tree();

        consolidate(src.path(), game.path(), true).expect("first");
        let files = vendored_files(game.path());
        assert!(consolidate(src.path(), game.path(), true)
            .expect("second")
            .is_empty());

        assert_eq!(files, vendored_files(game.path()));
    }

    /// The version marker reads back out of the game's own `missions/` spelling,
    /// because the sandbox resolves a path literally where the engine does not.
    #[test]
    fn the_marker_reads_back_from_the_games_own_casing() {
        let src = source_tree();
        let game = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(game.path().join("Missions")).expect("mkdir");

        install(src.path(), game.path()).expect("install");

        assert!(game.path().join("Missions/runtime.lua").is_file());
        assert!(marker_present(game.path()));
        assert_eq!(read_marker(game.path()).expect("marker")["version"], 1);
    }
}
