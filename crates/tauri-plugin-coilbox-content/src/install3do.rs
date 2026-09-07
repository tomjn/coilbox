//! Installing a batch `.3do` -> `.s3o` conversion (issue #2573) into the game
//! it came from (issue #2622).
//!
//! The conversion itself only ever writes to an output folder the user picked,
//! and leaves getting that into an actual game to them. Two steps are not
//! obvious, and getting either wrong produces a game that either silently
//! keeps its old models or crashes on startup:
//!
//! 1. The engine's model loader tries `.3do` before `.s3o` for an
//!    `objectname` with no extension (`CModelLoader::FindModelPath`,
//!    `rts/Rendering/Models/IModelParser.cpp`), so a converted `.s3o` sitting
//!    next to the `.3do` it replaces is never reached. The original has to go.
//! 2. A unit definition that spells `.3do` in its `objectname` (Balanced
//!    Annihilation's `armdrag`/`cordrag`) keeps naming the file that is now
//!    gone, and BA's own gadgets index those unit names unconditionally and
//!    crash on load if the definition is dropped for a missing model.
//!
//! [`install`] does both, in one pass over one already-open `.sdd` game. The
//! original `.3do` is moved aside rather than deleted (issue #2622 point 2
//! asks for something reversible), and every text file it edits gets the same
//! treatment before the edit lands. [`undo`] reverses both by name alone: find
//! every `BACKUP_SUFFIX` file under the game and put it back.
//!
//! A `.sdz`/`.sd7` is one packed file, and there is no sound way to rewrite
//! one of those in place, so [`install`] refuses anything that is not a
//! `.sdd` (issue #2622 point 3). The caller is expected to hide the button
//! for a packed archive, and this check is the backstop.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::json;

/// What a backup file this feature wrote is named after the file it holds a
/// copy of. Distinct from a plain `.bak` so [`undo`] only ever restores what
/// an install here actually touched, never a stray backup a user's own editor
/// left beside a file it happens to share a folder with.
const BACKUP_SUFFIX: &str = ".coilbox-3do-backup";

/// The one folder a converted game's models land under, matching
/// `coilbox_unitsync_worker::unitmodel::MODEL_DIR`. Not shared as a crate
/// dependency: this plugin has no other reason to depend on the unitsync
/// worker, and the two only need to agree on one folder name.
const MODEL_DIR: &str = "objects3d";

/// One installed conversion.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOutcome {
    /// How many files were copied from the conversion's output into the game.
    pub files_copied: usize,
    /// Original `.3do` files moved aside so their `.s3o` replacement is
    /// reachable, as the path inside the game they were found at.
    pub originals_moved_aside: Vec<String>,
    /// Models already installed by an earlier run: their backup already
    /// existed, so nothing further was done for them. Not an error, and not
    /// re-backed-up, so a first install's backup is never overwritten by a
    /// second run's already-patched state.
    pub already_installed: Vec<String>,
    /// A converted model whose original `.3do` could not be found in the
    /// game, named so the report says why one fewer model than expected got
    /// moved aside rather than staying silent about it.
    pub missing_original: Vec<String>,
    /// Unit definitions that named a converted model's `.3do` extension
    /// directly and had it stripped, as the path inside the game.
    pub unit_defs_patched: Vec<String>,
}

/// One undo.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoOutcome {
    /// Every file [`install`] touched, restored from its backup, as the path
    /// inside the game.
    pub restored: Vec<String>,
}

/// `game_dir` must be a `.sdd`: a `.sdz`/`.sd7` is one file, and there is no
/// sound way to rewrite one of those in place (issue #2622 point 3).
fn require_sdd(game_dir: &Path) -> Result<(), String> {
    let is_sdd = game_dir
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("sdd"));
    if !is_sdd || !game_dir.is_dir() {
        return Err(
            "only a .sdd game can be installed into directly. A packed .sdz or .sd7 is one \
             file, so copy the converted output over the game and remove the original .3do \
             files yourself, or extract the game to a .sdd first."
                .to_string(),
        );
    }
    Ok(())
}

/// `game_dir`'s immediate parent must be a content root's `games/`, the same
/// restriction `archives::classify` puts on deleting an archive. This plugin
/// already only ever hands this function a path it scanned as a game, but the
/// check is cheap and this feature can rewrite many files, so it is worth
/// having its own backstop rather than trusting the caller alone.
fn require_in_games_dir(game_dir: &Path) -> Result<(), String> {
    let parent_ok = game_dir
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.eq_ignore_ascii_case("games"));
    if !parent_ok {
        return Err(
            "only a game in a content root's games folder can be installed into".to_string(),
        );
    }
    Ok(())
}

/// A relative path, forward-slash separated regardless of platform.
fn key(rel: &Path) -> String {
    rel.to_string_lossy().replace('\\', "/")
}

/// Every model the conversion wrote, as the path (forward slashes, original
/// case) under `objects3d/` it will occupy in the game, without extension.
fn model_stems(out_dir: &Path) -> Result<Vec<String>, String> {
    let root = out_dir.join(MODEL_DIR);
    if !root.is_dir() {
        return Err(format!(
            "{} has no {MODEL_DIR}/ folder, run a conversion into it first",
            out_dir.display()
        ));
    }
    let mut out = Vec::new();
    collect_stems(&root, &root, &mut out);
    out.sort();
    if out.is_empty() {
        return Err(format!(
            "{} has no converted .s3o models to install",
            out_dir.display()
        ));
    }
    Ok(out)
}

fn collect_stems(root: &Path, at: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(at) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_stems(root, &path, out);
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("s3o"))
        {
            if let Ok(rel) = path.strip_prefix(root) {
                out.push(key(&rel.with_extension("")));
            }
        }
    }
}

/// Recursively copy `src` into `dst`, creating `dst`, and say how many files
/// landed.
fn copy_tree(src: &Path, dst: &Path) -> Result<usize, String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("could not create {}: {e}", dst.display()))?;
    let mut count = 0;
    for entry in
        std::fs::read_dir(src).map_err(|e| format!("could not read {}: {e}", src.display()))?
    {
        let entry =
            entry.map_err(|e| format!("could not read an entry under {}: {e}", src.display()))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            count += copy_tree(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)
                .map_err(|e| format!("could not copy {}: {e}", from.display()))?;
            count += 1;
        }
    }
    Ok(count)
}

/// Where a backup of `path` goes.
fn backup_path(path: &Path) -> PathBuf {
    let mut os = path.as_os_str().to_os_string();
    os.push(BACKUP_SUFFIX);
    PathBuf::from(os)
}

/// Where a converted `stem`'s original `.3do` would sit in the game, in the
/// exact case the archive listing gave it. A path this builds may or may not
/// exist: it is also how [`install`] recognises a model it already moved
/// aside, by checking for a backup at this same name, before the file it
/// would otherwise look for is even gone.
fn expected_original(game_dir: &Path, stem: &str) -> PathBuf {
    let mut path = game_dir.join(MODEL_DIR);
    for segment in stem.split('/') {
        path.push(segment);
    }
    path.set_extension("3do");
    path
}

/// The original `.3do` a converted `stem` replaces, if the game still has it.
/// Tries [`expected_original`]'s exact case first, since that is what
/// `out_member` (`coilbox_unitsync_worker::convert3do`) preserves, then falls
/// back to a case-insensitive match in the same folder for a game whose file
/// happens to differ.
fn resolve_original(game_dir: &Path, stem: &str) -> Option<PathBuf> {
    let path = expected_original(game_dir, stem);
    if path.is_file() {
        return Some(path);
    }
    let parent = path.parent()?;
    let wanted = path.file_name()?.to_string_lossy().to_ascii_lowercase();
    std::fs::read_dir(parent).ok()?.flatten().find_map(|entry| {
        let candidate = entry.path();
        let matches = candidate.is_file()
            && candidate
                .file_name()
                .map(|n| n.to_string_lossy().to_ascii_lowercase() == wanted)
                .unwrap_or(false);
        matches.then_some(candidate)
    })
}

/// Every `.lua` file under `root`. Balanced Annihilation, Basically OTA (via
/// XTA) and every other Recoil-era game coilbox has been tested against write
/// unit definitions as Lua tables. The old Total Annihilation `.fbi`/`.tdf`
/// key=value shape has no quoted strings to match the same way, and is out
/// of scope here.
fn lua_files_under(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    walk_lua(root, &mut out);
    out
}

fn walk_lua(at: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(at) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_lua(&path, out);
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("lua"))
        {
            out.push(path);
        }
    }
}

/// Rewrite the first `objectname` field on `line` in place, if it names a
/// converted model's `.3do` extension directly, and the extension is why the
/// model would still fail to load (issue #2622 point 2). `stems` holds every
/// model the conversion wrote, lower-cased with forward slashes.
///
/// Hand-rolled rather than a `regex` dependency: the shape is one quoted
/// value after one key on one line, which is what every unit definition in
/// the games this was checked against (`objectname = "ARMDRAG.3do",`) does,
/// and matching four characters at the end of a quoted string does not need a
/// general pattern language.
fn patch_line(line: &str, stems: &BTreeSet<String>) -> Option<String> {
    let lower = line.to_ascii_lowercase();
    let key_at = lower.find("objectname")?;
    let after_key_lower = &lower[key_at + "objectname".len()..];
    let eq_at = key_at + "objectname".len() + after_key_lower.find('=')?;
    let after_eq = &line[eq_at + 1..];
    let quote_rel = after_eq.find(|c: char| !c.is_whitespace())?;
    let quote = after_eq[quote_rel..].chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let value_rel_start = quote_rel + quote.len_utf8();
    let after_quote = &after_eq[value_rel_start..];
    let value_len = after_quote.find(quote)?;
    let value = &after_quote[..value_len];
    if value.len() < 4 || !value[value.len() - 4..].eq_ignore_ascii_case(".3do") {
        return None;
    }
    let base = &value[..value.len() - 4];
    let normalized = base.replace('\\', "/").to_ascii_lowercase();
    if !stems.contains(&normalized) {
        return None;
    }
    let value_abs_start = eq_at + 1 + value_rel_start;
    let value_abs_end = value_abs_start + value.len();
    Some(format!(
        "{}{}{}",
        &line[..value_abs_start],
        base,
        &line[value_abs_end..]
    ))
}

/// Rewrite every line of `text` that [`patch_line`] would change, or `None`
/// when nothing on any line named a converted model's `.3do` extension.
fn patch_objectnames(text: &str, stems: &BTreeSet<String>) -> Option<String> {
    let mut changed = false;
    let mut out = String::with_capacity(text.len());
    for line in text.split_inclusive('\n') {
        match patch_line(line, stems) {
            Some(patched) => {
                changed = true;
                out.push_str(&patched);
            }
            None => out.push_str(line),
        }
    }
    changed.then_some(out)
}

/// Install a batch `.3do` conversion's output (from `out_dir`) into the game
/// at `game_dir`: copy the converted models and sheets in, move aside every
/// original `.3do` they replace, and strip the extension from any unit
/// definition that names one directly.
///
/// Safe to run again: a model or file already backed up by an earlier run is
/// left alone rather than re-processed, so a second install can never
/// overwrite the backup with already-patched state.
pub fn install(game_dir: &Path, out_dir: &Path) -> Result<InstallOutcome, String> {
    require_sdd(game_dir)?;
    require_in_games_dir(game_dir)?;
    let stems = model_stems(out_dir)?;

    let files_copied = copy_tree(out_dir, game_dir)?;

    let stems_lower: BTreeSet<String> = stems.iter().map(|s| s.to_ascii_lowercase()).collect();

    let mut originals_moved_aside = Vec::new();
    let mut already_installed = Vec::new();
    let mut missing_original = Vec::new();
    for stem in &stems {
        // Checked before looking for the file itself: once a model has been
        // moved aside, `expected_original` no longer exists to find, and the
        // backup at this name is the only trace an earlier install left.
        if backup_path(&expected_original(game_dir, stem)).is_file() {
            already_installed.push(stem.clone());
            continue;
        }
        match resolve_original(game_dir, stem) {
            Some(path) => {
                let backup = backup_path(&path);
                std::fs::rename(&path, &backup)
                    .map_err(|e| format!("could not move {} aside: {e}", path.display()))?;
                if let Ok(rel) = path.strip_prefix(game_dir) {
                    originals_moved_aside.push(key(rel));
                }
            }
            None => missing_original.push(format!("{MODEL_DIR}/{stem}.3do")),
        }
    }

    let mut unit_defs_patched = Vec::new();
    for path in lua_files_under(game_dir) {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Some(patched) = patch_objectnames(&text, &stems_lower) else {
            continue;
        };
        let backup = backup_path(&path);
        if !backup.exists() {
            std::fs::copy(&path, &backup)
                .map_err(|e| format!("could not back up {}: {e}", path.display()))?;
        }
        std::fs::write(&path, patched)
            .map_err(|e| format!("could not write {}: {e}", path.display()))?;
        if let Ok(rel) = path.strip_prefix(game_dir) {
            unit_defs_patched.push(key(rel));
        }
    }

    Ok(InstallOutcome {
        files_copied,
        originals_moved_aside,
        already_installed,
        missing_original,
        unit_defs_patched,
    })
}

fn collect_backups(at: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(at) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_backups(&path, out);
        } else if path
            .file_name()
            .map(|n| n.to_string_lossy().ends_with(BACKUP_SUFFIX))
            .unwrap_or(false)
        {
            out.push(path);
        }
    }
}

fn strip_backup_suffix(path: &Path) -> Option<PathBuf> {
    let s = path.as_os_str().to_string_lossy();
    s.strip_suffix(BACKUP_SUFFIX).map(PathBuf::from)
}

/// How many files an earlier [`install`] into `game_dir` left a backup for,
/// which is exactly what [`undo`] would restore. Used to decide whether to
/// offer an undo at all, independent of whatever the current session's
/// install report says: the backups outlive the drawer that wrote them.
pub fn status(game_dir: &Path) -> usize {
    if !game_dir.is_dir() {
        return 0;
    }
    let mut backups = Vec::new();
    collect_backups(game_dir, &mut backups);
    backups.len()
}

/// Reverse every [`install`] into `game_dir`: for every backup file found,
/// remove whatever currently sits at the original name and put the backup
/// back under it.
///
/// This never touches the `.s3o`/atlas files an install copied in. The
/// restored `.3do` wins them back on its own (issue #2622 point 1's own
/// rule, run in reverse), so leaving them in place is harmless rather than
/// something undo also has to track and remove.
pub fn undo(game_dir: &Path) -> Result<UndoOutcome, String> {
    require_sdd(game_dir)?;
    let mut backups = Vec::new();
    collect_backups(game_dir, &mut backups);

    let mut restored = Vec::new();
    for backup in backups {
        let Some(original) = strip_backup_suffix(&backup) else {
            continue;
        };
        if original.exists() {
            std::fs::remove_file(&original)
                .map_err(|e| format!("could not remove {}: {e}", original.display()))?;
        }
        std::fs::rename(&backup, &original)
            .map_err(|e| format!("could not restore {}: {e}", original.display()))?;
        if let Ok(rel) = original.strip_prefix(game_dir) {
            restored.push(key(rel));
        }
    }
    Ok(UndoOutcome { restored })
}

/// `content_install_3do_conversion`: install a batch conversion's output
/// (`outDir`) into the `.sdd` game it came from (`gameDir`).
#[tauri::command]
pub(crate) async fn content_install_3do_conversion(game_dir: String, out_dir: String) -> CliResult {
    let (g, o) = (PathBuf::from(game_dir), PathBuf::from(out_dir));
    match tauri::async_runtime::spawn_blocking(move || install(&g, &o)).await {
        Ok(Ok(outcome)) => CliResult::ok(json!(outcome)),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("install task failed: {e}")),
    }
}

/// `content_undo_3do_install`: reverse every change an earlier
/// `content_install_3do_conversion` made under `gameDir`.
#[tauri::command]
pub(crate) async fn content_undo_3do_install(game_dir: String) -> CliResult {
    let g = PathBuf::from(game_dir);
    match tauri::async_runtime::spawn_blocking(move || undo(&g)).await {
        Ok(Ok(outcome)) => CliResult::ok(json!(outcome)),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("undo task failed: {e}")),
    }
}

/// `content_3do_install_status`: how many backups an earlier install left
/// under `gameDir`, so the frontend can offer undo even in a freshly opened
/// drawer that never ran the install itself this session.
#[tauri::command]
pub(crate) async fn content_3do_install_status(game_dir: String) -> CliResult {
    let g = PathBuf::from(game_dir);
    match tauri::async_runtime::spawn_blocking(move || status(&g)).await {
        Ok(backups) => CliResult::ok(json!({ "backups": backups })),
        Err(e) => CliResult::err(format!("install status task failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cbx-install3do-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// A minimal game: two 3do models (one plain, one an armdrag-shaped unit
    /// that spells the extension in its objectname) and their unit
    /// definitions, plus a converted output for both.
    fn fixture(tag: &str) -> (PathBuf, PathBuf) {
        let root = tmp(tag);
        let game = root.join("games").join("ba.sdd");
        write(&game.join("objects3d/armcom.3do"), "3do bytes");
        write(&game.join("objects3d/armdrag.3do"), "3do bytes");
        write(
            &game.join("units/armcom.lua"),
            "return {\n armcom = {\n  objectname = \"ARMCOM\",\n },\n}\n",
        );
        write(
            &game.join("units/armdrag.lua"),
            "return {\n armdrag = {\n  objectname = \"ARMDRAG.3do\",\n },\n}\n",
        );

        let out = root.join("out");
        write(&out.join("objects3d/armcom.s3o"), "s3o bytes");
        write(&out.join("objects3d/armdrag.s3o"), "s3o bytes");
        write(&out.join("unittextures/3do/objects3d.png"), "png bytes");
        (game, out)
    }

    #[test]
    fn install_moves_originals_aside_and_copies_the_conversion_in() {
        let (game, out) = fixture("basic");

        let outcome = install(&game, &out).expect("install");

        assert_eq!(outcome.files_copied, 3);
        assert!(game.join("objects3d/armcom.s3o").is_file());
        assert!(game.join("unittextures/3do/objects3d.png").is_file());
        assert!(!game.join("objects3d/armcom.3do").exists());
        assert!(game
            .join("objects3d/armcom.3do.coilbox-3do-backup")
            .is_file());
        assert_eq!(
            std::fs::read_to_string(game.join("objects3d/armcom.3do.coilbox-3do-backup")).unwrap(),
            "3do bytes"
        );
        assert_eq!(
            outcome.originals_moved_aside,
            vec![
                "objects3d/armcom.3do".to_string(),
                "objects3d/armdrag.3do".to_string()
            ]
        );
        assert!(outcome.missing_original.is_empty());
    }

    /// The one concrete case the issue is written around: Balanced
    /// Annihilation's `armdrag`/`cordrag` name their model with the extension,
    /// and that has to come off or the unit definition still points at a
    /// model that is now gone.
    #[test]
    fn strips_the_extension_from_a_unit_definition_that_spells_it() {
        let (game, out) = fixture("armdrag");

        let outcome = install(&game, &out).expect("install");

        assert_eq!(outcome.unit_defs_patched, vec!["units/armdrag.lua"]);
        let patched = std::fs::read_to_string(game.join("units/armdrag.lua")).unwrap();
        assert!(patched.contains("objectname = \"ARMDRAG\","));
        assert!(!patched.contains(".3do"));
        // The plain unit's definition, which never named an extension, is
        // untouched.
        let untouched = std::fs::read_to_string(game.join("units/armcom.lua")).unwrap();
        assert_eq!(
            untouched,
            "return {\n armcom = {\n  objectname = \"ARMCOM\",\n },\n}\n"
        );
    }

    #[test]
    fn a_second_install_does_not_reprocess_what_the_first_already_moved() {
        let (game, out) = fixture("idempotent");
        install(&game, &out).expect("first install");

        let outcome = install(&game, &out).expect("second install");

        assert_eq!(
            outcome.already_installed,
            vec!["armcom".to_string(), "armdrag".to_string()]
        );
        assert!(outcome.originals_moved_aside.is_empty());
        // The unit def has no `.3do` left to find, so nothing is patched
        // again and the existing backup is not touched a second time.
        assert!(outcome.unit_defs_patched.is_empty());
    }

    #[test]
    fn undo_restores_the_original_model_and_the_original_unit_definition() {
        let (game, out) = fixture("undo");
        let before_def = std::fs::read_to_string(game.join("units/armdrag.lua")).unwrap();
        install(&game, &out).expect("install");

        let outcome = undo(&game).expect("undo");

        assert_eq!(outcome.restored.len(), 3, "{:?}", outcome.restored);
        assert_eq!(
            std::fs::read_to_string(game.join("objects3d/armcom.3do")).unwrap(),
            "3do bytes"
        );
        assert_eq!(
            std::fs::read_to_string(game.join("units/armdrag.lua")).unwrap(),
            before_def
        );
        // The converted files stay: harmless, since a restored .3do wins
        // over them again on its own.
        assert!(game.join("objects3d/armcom.s3o").is_file());
        assert_eq!(status(&game), 0);
    }

    #[test]
    fn refuses_a_packed_archive() {
        let root = tmp("packed");
        let sdz = root.join("games").join("ba.sdz");
        write(&sdz, "not really a zip");
        let out = root.join("out");
        write(&out.join("objects3d/armcom.s3o"), "s3o bytes");

        assert!(install(&sdz, &out).is_err());
    }

    #[test]
    fn refuses_a_game_outside_a_content_roots_games_folder() {
        let root = tmp("outside");
        let game = root.join("elsewhere").join("ba.sdd");
        std::fs::create_dir_all(&game).unwrap();
        let out = root.join("out");
        write(&out.join("objects3d/armcom.s3o"), "s3o bytes");

        assert!(install(&game, &out).is_err());
    }

    #[test]
    fn refuses_an_output_folder_with_nothing_converted() {
        let root = tmp("empty-out");
        let game = root.join("games").join("ba.sdd");
        std::fs::create_dir_all(&game).unwrap();
        let out = root.join("out");
        std::fs::create_dir_all(&out).unwrap();

        assert!(install(&game, &out).is_err());
    }

    #[test]
    fn status_counts_backups_left_by_an_earlier_session() {
        let (game, out) = fixture("status");
        assert_eq!(status(&game), 0);
        install(&game, &out).expect("install");
        assert_eq!(status(&game), 3);
    }
}
