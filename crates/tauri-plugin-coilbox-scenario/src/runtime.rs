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

use coilbox_springlua::SpringLua;
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

/// Where the bundled runtime lives.
///
/// `bundle.resources` is assembled by `tauri build`, and the in-bundle layout of
/// a `../`-relative entry varies by bundler, so the candidates are probed rather
/// than assumed. Under `tauri dev` there are no resources beside the binary at
/// all, hence the source-tree fallback in debug builds.
pub fn runtime_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let bundled = app.path().resource_dir().ok().and_then(|dir| {
        [
            "lua/mission-runtime",
            "_up_/lua/mission-runtime",
            "mission-runtime",
        ]
        .into_iter()
        .map(|rel| dir.join(rel))
        .find(|path| path.is_dir())
    });
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
/// Dot-files are skipped: the source tree is a working copy, and a `.DS_Store`
/// is not part of what a game vendors.
fn vendored_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for tree in VENDORED {
        walk(&root.join(tree), Path::new(tree), &mut files);
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
/// Case is dropped because a game folder's casing is its own. Real games ship
/// `LuaRules/Gadgets/`, and on Windows and macOS that is the same folder as the
/// `luarules/gadgets/` written into it. The engine agrees: an archive's file
/// index is keyed lower case, so both spellings load the same file.
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
        let to = dest.join(rel);
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
    let lua = SpringLua::new(root).map_err(|e| format!("could not start the Lua sandbox: {e}"))?;
    lua.include_value(rel).map_err(|e| {
        let raw = e.to_string();
        eprintln!(
            "coilbox-scenario: {} would not load: {raw}",
            root.join(rel).display()
        );
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
/// The path is the one an install writes, which is the only way a marker gets
/// there. A hand-vendored marker under some other spelling reads as absent, the
/// same as it did before this check existed.
pub fn marker_present(root: &Path) -> bool {
    root.join(MARKER).is_file()
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

    /// Games spell it `LuaRules/Gadgets/`. On Windows and macOS that is the same
    /// folder the install writes into, so the file lands under the game's
    /// spelling and the prune has to recognise it as the one just written.
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
}
