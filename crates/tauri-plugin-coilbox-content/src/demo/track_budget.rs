//! How much disk space recorded tracks may use, and which go first (#3787).
//!
//! A track is a cache that can be made again from its replay, so a limit on the
//! space they use is safe to enforce by removing them. The limit is the user's
//! setting [`SETTING_KEY`], read from the settings file each time it is needed.
//!
//! - [`enforce`] runs after a recording has been stored. It never runs for a
//!   recording that failed, so a failed recording cannot cost the only copy of
//!   an earlier track.
//! - Stale tracks go first, since a stale track cannot be played. Then the
//!   track watched longest ago. Ties go in game id order.
//! - The track just stored is never removed to make room for itself, and nor is
//!   one the caller says is in use. If that leaves the total over the limit, the
//!   total stays over until the next recording or until the user clears.
//! - A new track larger than the whole limit is kept, and everything else that
//!   may go is removed. The player asked for that recording, and losing it
//!   silently would be worse than being over the limit.
//! - Lowering the limit does nothing by itself. The next recording applies it.

use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use super::track_store::{self, StoredTrack, TrackState};

/// The settings key the limit is stored under, in bytes. Mirrored in
/// `src/content/replayTracks.ts`.
pub const SETTING_KEY: &str = "content.replayTrackBudgetBytes";

/// One mebibyte, the unit the settings page asks for the limit in.
const MIB: u64 = 1024 * 1024;

/// The default limit: 450 MiB, which holds 100 tracks the size of a BAR match.
///
/// Measured: a 45.83 minute BAR match between two AIs (82,496 frames, 1,368
/// units) is a 4,713,582 byte track, and a 12.83 minute Splinter Faction match
/// (57 units) is 289,328 bytes. 100 x 4,713,582 = 471,358,200 bytes = 449.5 MiB,
/// rounded up to 450 MiB (471,859,200 bytes, 100.1 BAR sized tracks). No match
/// between humans has been measured, and one with more units will be larger.
pub const DEFAULT_BUDGET_BYTES: u64 = 450 * MIB;

/// The limit in the settings file's text, or the default.
///
/// The file is the frame's store, a map of keys to JSON encoded strings, so the
/// number is inside a string. Anything that is not a whole number of bytes is
/// not an answer, and reads as the default.
pub fn budget_from_settings(settings_json: Option<&str>) -> u64 {
    let stored = settings_json
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
        .and_then(|map| map.get(SETTING_KEY)?.as_str().map(str::to_owned))
        .and_then(|encoded| serde_json::from_str::<Value>(&encoded).ok())
        .and_then(|value| value.as_u64());
    stored.unwrap_or(DEFAULT_BUDGET_BYTES)
}

/// The limit saved in the settings file at `path`, or the default.
pub fn read_budget(path: &Path) -> u64 {
    budget_from_settings(std::fs::read_to_string(path).ok().as_deref())
}

/// What every track on disk takes, stale ones included.
pub fn total_bytes(dir: &Path) -> u64 {
    track_store::list(dir).iter().map(|t| t.size_bytes).sum()
}

/// Which tracks to remove to bring `tracks` within `budget`, in the order to
/// remove them.
///
/// `keep` is the track just stored, which is counted and never chosen. A game
/// id in `in_use` is counted and never chosen. The answer stops as soon as the
/// total fits, or when nothing that may go is left.
pub fn evictions(
    tracks: &[StoredTrack],
    keep: Option<&str>,
    budget: u64,
    in_use: &HashSet<String>,
) -> Vec<String> {
    let mut total: u64 = tracks.iter().map(|t| t.size_bytes).sum();
    let mut candidates: Vec<&StoredTrack> = tracks
        .iter()
        .filter(|t| Some(t.game_id.as_str()) != keep && !in_use.contains(&t.game_id))
        .collect();
    candidates.sort_by(|a, b| {
        let current = |t: &StoredTrack| t.state == TrackState::Current;
        (current(a), a.last_watched_ms, &a.game_id).cmp(&(
            current(b),
            b.last_watched_ms,
            &b.game_id,
        ))
    });
    let mut chosen = Vec::new();
    for track in candidates {
        if total <= budget {
            break;
        }
        total -= track.size_bytes;
        chosen.push(track.game_id.clone());
    }
    chosen
}

/// Remove tracks from `dir` until what is left fits `budget`, and say which
/// were removed. A track that cannot be removed is skipped and the next one
/// tried, so one locked file does not stop the rest.
pub fn enforce(
    dir: &Path,
    keep: Option<&str>,
    budget: u64,
    in_use: &HashSet<String>,
) -> Vec<String> {
    evictions(&track_store::list(dir), keep, budget, in_use)
        .into_iter()
        .filter(|id| track_store::remove(dir, id).unwrap_or(false))
        .collect()
}

/// What clearing the tracks did.
#[derive(Serialize, Default, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Cleared {
    pub removed: usize,
    pub freed_bytes: u64,
    /// Tracks left because they are in use.
    pub kept: usize,
}

/// Remove every track except those in `in_use`.
pub fn clear(dir: &Path, in_use: &HashSet<String>) -> Cleared {
    let mut cleared = Cleared::default();
    for track in track_store::list(dir) {
        if in_use.contains(&track.game_id) {
            cleared.kept += 1;
        } else if track_store::remove(dir, &track.game_id).unwrap_or(false) {
            cleared.removed += 1;
            cleared.freed_bytes += track.size_bytes;
        }
    }
    cleared
}

#[cfg(test)]
mod tests {
    use super::*;
    use coilbox_track::{Settings, Track};
    use coilbox_track_thin::RECORDER_VERSION;
    use std::time::{Duration, SystemTime};

    fn id(n: u8) -> String {
        format!("{n:02x}").repeat(16)
    }

    fn stored(game_id: &str, state: TrackState, size: u64, watched: u64) -> StoredTrack {
        StoredTrack {
            game_id: game_id.into(),
            state,
            size_bytes: size,
            last_watched_ms: watched,
        }
    }

    fn current(n: u8, size: u64, watched: u64) -> StoredTrack {
        stored(&id(n), TrackState::Current, size, watched)
    }

    fn none() -> HashSet<String> {
        HashSet::new()
    }

    fn ids(list: &[String]) -> Vec<String> {
        list.to_vec()
    }

    // ---- the order ----------------------------------------------------------

    #[test]
    fn the_track_watched_longest_ago_goes_first() {
        let tracks = [
            current(1, 10, 300),
            current(2, 10, 100),
            current(3, 10, 200),
        ];
        assert_eq!(evictions(&tracks, None, 20, &none()), vec![id(2)]);
        assert_eq!(evictions(&tracks, None, 10, &none()), vec![id(2), id(3)]);
    }

    #[test]
    fn nothing_is_removed_while_the_total_fits() {
        let tracks = [current(1, 10, 1), current(2, 10, 2)];
        assert!(evictions(&tracks, None, 20, &none()).is_empty());
        assert!(evictions(&tracks, None, 21, &none()).is_empty());
    }

    #[test]
    fn a_stale_track_goes_before_a_current_one_watched_longer_ago() {
        let tracks = [
            current(1, 10, 1),
            stored(&id(2), TrackState::Stale, 10, 999),
            current(3, 10, 2),
        ];
        assert_eq!(evictions(&tracks, None, 20, &none()), vec![id(2)]);
        assert_eq!(evictions(&tracks, None, 10, &none()), vec![id(2), id(1)]);
    }

    #[test]
    fn tracks_watched_at_the_same_moment_go_in_game_id_order() {
        let mut tracks = vec![current(3, 10, 5), current(1, 10, 5), current(2, 10, 5)];
        let first = evictions(&tracks, None, 10, &none());
        assert_eq!(first, vec![id(1), id(2)]);
        tracks.reverse();
        assert_eq!(evictions(&tracks, None, 10, &none()), first);
    }

    #[test]
    fn the_track_just_stored_is_counted_and_never_chosen() {
        // The new track is the oldest, so by time alone it would go first.
        let tracks = [current(1, 10, 1), current(2, 10, 50), current(3, 10, 60)];
        let chosen = evictions(&tracks, Some(&id(1)), 20, &none());
        assert_eq!(chosen, vec![id(2)]);
    }

    #[test]
    fn a_track_in_use_is_counted_and_never_chosen() {
        let tracks = [current(1, 10, 1), current(2, 10, 2), current(3, 10, 3)];
        let in_use: HashSet<String> = [id(1)].into();
        // Without the set, 1 is first. With it, 2 goes, then 3.
        assert_eq!(evictions(&tracks, None, 20, &none()), vec![id(1)]);
        assert_eq!(evictions(&tracks, None, 20, &in_use), vec![id(2)]);
        assert_eq!(evictions(&tracks, None, 0, &in_use), vec![id(2), id(3)]);
    }

    #[test]
    fn a_stale_track_in_use_is_kept_too() {
        let tracks = [stored(&id(1), TrackState::Stale, 10, 1), current(2, 10, 2)];
        let in_use: HashSet<String> = [id(1)].into();
        assert_eq!(evictions(&tracks, None, 10, &in_use), vec![id(2)]);
    }

    #[test]
    fn a_new_track_larger_than_the_whole_budget_is_kept_and_everything_else_goes() {
        let tracks = [current(1, 10, 1), current(2, 10, 2), current(3, 500, 99)];
        let chosen = evictions(&tracks, Some(&id(3)), 100, &none());
        assert_eq!(chosen, vec![id(1), id(2)]);
    }

    #[test]
    fn a_track_in_use_can_leave_the_total_over_the_budget() {
        let tracks = [current(1, 100, 1), current(2, 10, 2)];
        let in_use: HashSet<String> = [id(1)].into();
        assert_eq!(ids(&evictions(&tracks, None, 50, &in_use)), vec![id(2)]);
    }

    // ---- the budget setting -------------------------------------------------

    #[test]
    fn the_default_holds_a_hundred_bar_sized_tracks_and_not_a_hundred_and_one_and_a_half() {
        const BAR_SIZED: u64 = 4_713_582;
        assert!(DEFAULT_BUDGET_BYTES >= 100 * BAR_SIZED);
        assert!(DEFAULT_BUDGET_BYTES < 101 * BAR_SIZED);
    }

    #[test]
    fn a_saved_budget_is_read_from_the_frames_encoded_string() {
        let file = format!(r#"{{"{SETTING_KEY}":"1048576","theme":"\"blue\""}}"#);
        assert_eq!(budget_from_settings(Some(&file)), 1_048_576);
    }

    #[test]
    fn no_saved_budget_is_the_default() {
        assert_eq!(budget_from_settings(None), DEFAULT_BUDGET_BYTES);
        assert_eq!(budget_from_settings(Some("{}")), DEFAULT_BUDGET_BYTES);
        assert_eq!(budget_from_settings(Some("not json")), DEFAULT_BUDGET_BYTES);
    }

    #[test]
    fn a_saved_budget_that_is_not_a_whole_number_is_the_default() {
        for bad in [
            r#""-5""#,
            r#""1.5""#,
            r#""\"12\"""#,
            r#""null""#,
            r#""abc""#,
            "5",
        ] {
            let file = format!(r#"{{"{SETTING_KEY}":{bad}}}"#);
            assert_eq!(
                budget_from_settings(Some(&file)),
                DEFAULT_BUDGET_BYTES,
                "{bad}"
            );
        }
    }

    #[test]
    fn a_budget_of_zero_is_a_budget() {
        let file = format!(r#"{{"{SETTING_KEY}":"0"}}"#);
        assert_eq!(budget_from_settings(Some(&file)), 0);
    }

    #[test]
    fn a_missing_settings_file_is_the_default() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            read_budget(&dir.path().join("nope.json")),
            DEFAULT_BUDGET_BYTES
        );
    }

    // ---- on disk ------------------------------------------------------------

    /// A whole track whose size is set by the length of the game name in it.
    fn put_track(dir: &Path, n: u8, padding: usize, age_seconds: u64) -> u64 {
        let game_id = id(n);
        let mut track = Track::new(Settings {
            recorder_version: RECORDER_VERSION,
            game_id: [n; 16],
            last_frame: 90,
            ..Settings::default()
        });
        track.info.game = (0..padding)
            .map(|i| char::from(b'a' + (i * 7 % 26) as u8))
            .collect();
        let bytes = track.to_bytes().expect("a small track writes");
        let size = track_store::store(dir, &game_id, |path| std::fs::write(path, &bytes))
            .expect("a track stores");
        std::fs::File::options()
            .write(true)
            .open(track_store::track_path(dir, &game_id).unwrap())
            .unwrap()
            .set_modified(SystemTime::now() - Duration::from_secs(age_seconds))
            .unwrap();
        size
    }

    fn left(dir: &Path) -> Vec<String> {
        let mut ids: Vec<String> = track_store::list(dir)
            .into_iter()
            .map(|t| t.game_id)
            .collect();
        ids.sort();
        ids
    }

    #[test]
    fn the_total_is_the_size_of_the_files_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(total_bytes(dir.path()), 0);
        let small = put_track(dir.path(), 1, 10, 0);
        let large = put_track(dir.path(), 2, 3000, 0);
        // A stale file takes space too, and so does one that is not a track.
        std::fs::write(
            track_store::track_path(dir.path(), &id(3)).unwrap(),
            b"not a track",
        )
        .unwrap();
        // Neither a temporary file nor a stray file is a track.
        std::fs::write(dir.path().join(format!("{}.cbtrack.tmp-1", id(4))), b"half").unwrap();
        std::fs::write(dir.path().join("notes.txt"), b"x").unwrap();

        let on_disk: u64 = [1u8, 2, 3]
            .iter()
            .map(|n| {
                std::fs::metadata(track_store::track_path(dir.path(), &id(*n)).unwrap())
                    .unwrap()
                    .len()
            })
            .sum();
        assert_eq!(total_bytes(dir.path()), on_disk);
        assert_ne!(
            small, large,
            "the sizes differ, so this is a test of something"
        );
    }

    #[test]
    fn enforcing_removes_files_oldest_first_until_they_fit() {
        let dir = tempfile::tempdir().unwrap();
        let a = put_track(dir.path(), 1, 100, 300);
        let b = put_track(dir.path(), 2, 100, 200);
        let c = put_track(dir.path(), 3, 100, 100);

        // Room for two: the oldest goes.
        let removed = enforce(dir.path(), None, b + c, &none());
        assert_eq!(removed, vec![id(1)]);
        assert_eq!(left(dir.path()), vec![id(2), id(3)]);
        assert_eq!(total_bytes(dir.path()), b + c);
        assert!(a > 0);
    }

    #[test]
    fn a_track_watched_since_is_removed_last() {
        let dir = tempfile::tempdir().unwrap();
        put_track(dir.path(), 1, 100, 300);
        put_track(dir.path(), 2, 100, 200);
        track_store::mark_watched(dir.path(), &id(1)).unwrap();

        let one = track_store::list(dir.path())[0].size_bytes;
        enforce(dir.path(), None, one, &none());

        assert_eq!(left(dir.path()), vec![id(1)]);
    }

    #[test]
    fn enforcing_never_removes_the_kept_track_or_one_in_use() {
        let dir = tempfile::tempdir().unwrap();
        put_track(dir.path(), 1, 100, 300);
        put_track(dir.path(), 2, 100, 200);
        put_track(dir.path(), 3, 100, 100);
        let in_use: HashSet<String> = [id(2)].into();

        let removed = enforce(dir.path(), Some(&id(1)), 0, &in_use);

        assert_eq!(removed, vec![id(3)]);
        assert_eq!(left(dir.path()), vec![id(1), id(2)]);
    }

    #[test]
    fn clearing_removes_every_track_and_says_how_much_it_freed() {
        let dir = tempfile::tempdir().unwrap();
        let a = put_track(dir.path(), 1, 10, 0);
        let b = put_track(dir.path(), 2, 2000, 0);
        std::fs::write(
            track_store::track_path(dir.path(), &id(3)).unwrap(),
            b"stale bytes",
        )
        .unwrap();
        std::fs::write(dir.path().join("notes.txt"), b"x").unwrap();

        let cleared = clear(dir.path(), &none());

        assert_eq!(
            cleared,
            Cleared {
                removed: 3,
                freed_bytes: a + b + 11,
                kept: 0
            }
        );
        assert!(left(dir.path()).is_empty());
        assert_eq!(total_bytes(dir.path()), 0);
        assert!(dir.path().join("notes.txt").exists(), "not a track");
    }

    #[test]
    fn clearing_leaves_a_track_in_use() {
        let dir = tempfile::tempdir().unwrap();
        put_track(dir.path(), 1, 10, 0);
        put_track(dir.path(), 2, 10, 0);
        let in_use: HashSet<String> = [id(2)].into();

        let cleared = clear(dir.path(), &in_use);

        assert_eq!((cleared.removed, cleared.kept), (1, 1));
        assert_eq!(left(dir.path()), vec![id(2)]);
    }

    #[test]
    fn clearing_nothing_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(clear(dir.path(), &none()), Cleared::default());
        assert_eq!(
            clear(&dir.path().join("missing"), &none()),
            Cleared::default()
        );
    }
}
