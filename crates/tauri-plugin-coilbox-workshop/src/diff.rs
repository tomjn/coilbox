//! A line diff of a workshop backup against the current file, or a whole file
//! addition when there is no backup (issue #2636).
//!
//! A game author committing the result of a workshop session to git wants to
//! see what changed on disk before deciding to keep it, the way `git diff`
//! would show outside the app. Unit files run to a few hundred lines, so a
//! classic longest-common-subsequence table is fast enough and easy to test,
//! and pulling in a diff crate is not worth it for that. `str::lines` strips a
//! trailing `\r`, so a `.sdd` with Windows line endings (SplinterFaction's
//! does) compares the same as one with Unix ones.
//!
//! This is a read: nothing here writes or deletes anything undo or accept
//! would need.

use std::path::Path;

use serde::Serialize;

use crate::inplace::{require_loose_game, MARKERS};

/// What one line of a diff is, from the old side, the new side, or both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LineChange {
    Equal,
    Removed,
    Added,
}

/// One line of a diff, numbered on whichever side(s) it appears on. Counted
/// from 1, the way the rest of this plugin's locations are.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: LineChange,
    pub old_line: Option<usize>,
    pub new_line: Option<usize>,
    pub text: String,
}

/// A line-by-line diff of `old` against `new`, aligned by longest common
/// subsequence so an edit in the middle of a file shows as a small change
/// rather than moving every line after it.
pub fn diff_lines(old: &str, new: &str) -> Vec<DiffLine> {
    let a: Vec<&str> = old.lines().collect();
    let b: Vec<&str> = new.lines().collect();
    let (n, m) = (a.len(), b.len());

    // lcs[i][j] is the length of the longest common subsequence of a[i..]
    // and b[j..], built from the empty suffix inward so the walk below can
    // read it forward.
    let mut lcs = vec![vec![0usize; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            lcs[i][j] = if a[i] == b[j] {
                lcs[i + 1][j + 1] + 1
            } else {
                lcs[i + 1][j].max(lcs[i][j + 1])
            };
        }
    }

    let mut out = Vec::with_capacity(n + m);
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if a[i] == b[j] {
            out.push(DiffLine {
                kind: LineChange::Equal,
                old_line: Some(i + 1),
                new_line: Some(j + 1),
                text: a[i].to_string(),
            });
            i += 1;
            j += 1;
        } else if lcs[i + 1][j] >= lcs[i][j + 1] {
            out.push(DiffLine {
                kind: LineChange::Removed,
                old_line: Some(i + 1),
                new_line: None,
                text: a[i].to_string(),
            });
            i += 1;
        } else {
            out.push(DiffLine {
                kind: LineChange::Added,
                old_line: None,
                new_line: Some(j + 1),
                text: b[j].to_string(),
            });
            j += 1;
        }
    }
    while i < n {
        out.push(DiffLine {
            kind: LineChange::Removed,
            old_line: Some(i + 1),
            new_line: None,
            text: a[i].to_string(),
        });
        i += 1;
    }
    while j < m {
        out.push(DiffLine {
            kind: LineChange::Added,
            old_line: None,
            new_line: Some(j + 1),
            text: b[j].to_string(),
        });
        j += 1;
    }
    out
}

/// One file's diff for the disk-diff drawer: either a workshop backup against
/// the current file, or a whole file addition when coilbox created it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    /// The file, relative to the game.
    pub file: String,
    /// Whether coilbox created this file rather than changing an existing
    /// one. A created file has no backup to diff against, so `lines` is the
    /// whole file as an addition.
    pub created: bool,
    pub lines: Vec<DiffLine>,
}

/// Every file under `game_dir` that carries a workshop backup or created
/// marker (issue #2636), each with the diff between what coilbox found and
/// what is there now.
pub fn disk_diffs(game_dir: &Path) -> Result<Vec<FileDiff>, String> {
    require_loose_game(game_dir)?;
    // An `.fbi` file from the Total Annihilation era may not be UTF-8 (issue
    // #2638), and is shown one character per byte, as the write read it.
    let read = |path: &Path| {
        std::fs::read(path)
            .map(|bytes| coilbox_tdf::decode(&bytes).0)
            .map_err(|e| format!("could not read {}: {e}", path.display()))
    };
    let rel = |file: &Path| coilbox_gamebackup::key(file.strip_prefix(game_dir).unwrap_or(file));

    let mut out = Vec::new();
    for backup in coilbox_gamebackup::collect(game_dir, MARKERS.backup) {
        let Some(file) = coilbox_gamebackup::without_suffix(&backup, MARKERS.backup) else {
            continue;
        };
        let old = read(&backup)?;
        let new = read(&file)?;
        out.push(FileDiff {
            file: rel(&file),
            created: false,
            lines: diff_lines(&old, &new),
        });
    }
    for marker in coilbox_gamebackup::collect(game_dir, MARKERS.created) {
        let Some(file) = coilbox_gamebackup::without_suffix(&marker, MARKERS.created) else {
            continue;
        };
        let new = read(&file)?;
        out.push(FileDiff {
            file: rel(&file),
            created: true,
            lines: diff_lines("", &new),
        });
    }
    out.sort_by(|a, b| a.file.cmp(&b.file));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(lines: &[DiffLine]) -> Vec<LineChange> {
        lines.iter().map(|l| l.kind).collect()
    }

    #[test]
    fn identical_text_is_all_equal() {
        let lines = diff_lines("a\nb\nc\n", "a\nb\nc\n");
        assert_eq!(kinds(&lines), vec![LineChange::Equal; 3]);
        assert_eq!(lines[1].old_line, Some(2));
        assert_eq!(lines[1].new_line, Some(2));
    }

    #[test]
    fn a_pure_insertion_adds_one_line_between_two_equal_runs() {
        let lines = diff_lines("a\nb\nc\n", "a\nb\nx\nc\n");
        assert_eq!(
            kinds(&lines),
            vec![
                LineChange::Equal,
                LineChange::Equal,
                LineChange::Added,
                LineChange::Equal
            ]
        );
        let added = &lines[2];
        assert_eq!(added.text, "x");
        assert_eq!(added.old_line, None);
        assert_eq!(added.new_line, Some(3));
    }

    #[test]
    fn a_pure_deletion_removes_one_line() {
        let lines = diff_lines("a\nb\nc\n", "a\nc\n");
        assert_eq!(
            kinds(&lines),
            vec![LineChange::Equal, LineChange::Removed, LineChange::Equal]
        );
        assert_eq!(lines[1].text, "b");
        assert_eq!(lines[1].old_line, Some(2));
        assert_eq!(lines[1].new_line, None);
    }

    #[test]
    fn a_replacement_in_the_middle_leaves_the_rest_of_the_file_equal() {
        let old = "one\ntwo\nthree\nfour\nfive\n";
        let new = "one\ntwo\nTHREE\nfour\nfive\n";
        let lines = diff_lines(old, new);
        assert_eq!(
            kinds(&lines),
            vec![
                LineChange::Equal,
                LineChange::Equal,
                LineChange::Removed,
                LineChange::Added,
                LineChange::Equal,
                LineChange::Equal,
            ]
        );
        assert_eq!(lines.last().unwrap().old_line, Some(5));
        assert_eq!(lines.last().unwrap().new_line, Some(5));
    }

    /// SplinterFaction's unit files are CRLF. `str::lines` strips the `\r`, so
    /// a file with nothing but line-ending differences from itself is all
    /// equal rather than every line reading as both removed and added.
    #[test]
    fn windows_line_endings_do_not_make_every_line_look_changed() {
        let text = "return {\r\n\tname = \"x\",\r\n}\r\n";
        let lines = diff_lines(text, text);
        assert_eq!(kinds(&lines), vec![LineChange::Equal; 3]);
        assert!(lines.iter().all(|l| !l.text.contains('\r')));
    }

    /// A file coilbox created has no backup, so the whole thing diffs as an
    /// addition (issue #2636): "new files show as whole-file additions".
    #[test]
    fn an_empty_old_side_diffs_as_a_whole_file_addition() {
        let lines = diff_lines("", "a\nb\n");
        assert_eq!(kinds(&lines), vec![LineChange::Added, LineChange::Added]);
        assert_eq!(lines[0].new_line, Some(1));
        assert_eq!(lines[1].new_line, Some(2));
    }

    fn game() -> (tempfile::TempDir, std::path::PathBuf) {
        let root = tempfile::tempdir().expect("temp dir");
        let game = root.path().join("games/dev.sdd");
        std::fs::create_dir_all(game.join("units")).unwrap();
        (root, game)
    }

    #[test]
    fn a_backed_up_file_diffs_against_its_original_and_a_created_one_is_a_whole_addition() {
        let (_root, game) = game();
        let changed = game.join("units/armcom.lua");
        std::fs::write(&changed, "return { armcom = { metalcost = 2 } }\n").unwrap();
        std::fs::write(
            coilbox_gamebackup::with_suffix(&changed, MARKERS.backup),
            "return { armcom = { metalcost = 1 } }\n",
        )
        .unwrap();
        let created = game.join("units/newunit.lua");
        std::fs::write(&created, "return { newunit = {} }\n").unwrap();
        std::fs::write(
            coilbox_gamebackup::with_suffix(&created, MARKERS.created),
            "",
        )
        .unwrap();

        let diffs = disk_diffs(&game).expect("diffs");

        assert_eq!(diffs.len(), 2);
        let armcom = diffs.iter().find(|d| d.file == "units/armcom.lua").unwrap();
        assert!(!armcom.created);
        assert!(armcom.lines.iter().any(|l| l.kind == LineChange::Removed));
        assert!(armcom.lines.iter().any(|l| l.kind == LineChange::Added));

        let newunit = diffs
            .iter()
            .find(|d| d.file == "units/newunit.lua")
            .unwrap();
        assert!(newunit.created);
        assert!(newunit.lines.iter().all(|l| l.kind == LineChange::Added));
    }

    #[test]
    fn a_game_outside_a_games_folder_is_refused() {
        let root = tempfile::tempdir().unwrap();
        let game = root.path().join("elsewhere/dev.sdd");
        std::fs::create_dir_all(&game).unwrap();
        assert!(disk_diffs(&game).is_err());
    }
}
