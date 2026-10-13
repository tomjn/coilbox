//! Where a replay's recorded track is kept (issue #3786).
//!
//! One file per match under the app's data directory, in
//! `content/replay-tracks/`, beside the folder replay analyses are kept in.
//! The file is named after the replay's game id, as an analysis is, so a
//! replay that is moved or renamed keeps its track. The data directory is the
//! resolved one, so a portable coilbox keeps its tracks in its own folder.
//!
//! A track is a cache: it can always be made again from the replay. So this
//! module only stores, reads the state of, lists and removes. What decides
//! when to record (#3785) and when to remove for space (#3787) calls these.
//!
//! The state of a replay's track is read from the file's header, which holds
//! the format version, the recorder version and the replay's game id. Nothing
//! is decompressed.
//!
//! - No file: no track.
//! - A file for this replay from the current recorder: [`TrackState::Current`].
//! - Anything else in this replay's slot is [`TrackState::Stale`]: a lower or
//!   higher recorder version, another format version, or a file that does not
//!   read as a track at all. A stale track is offered for recording again and
//!   is not played. A file that does not read is stale and not current because
//!   it can be recorded over, which is what stale already means.
//! - A file whose header names another game is not this replay's track, so it
//!   is no track for this replay. [`list`] still reports it, as stale, so a
//!   disk budget can see the space it takes.
//!
//! A track is written under a temporary name in the same folder and renamed
//! into place, so a file with a replay's name is always a whole one.
//!
//! The last watched time of a track is the file's modified time. It is set
//! when the track is stored and by [`mark_watched`], so nothing else is kept.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use coilbox_track::TrackReader;
use coilbox_track_thin::RECORDER_VERSION;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::analysis::store::valid_game_id;

/// The folder under `<data dir>/content/` that holds the files.
const DIR: &str = "replay-tracks";

/// What a stored file's name ends in.
pub const EXTENSION: &str = ".cbtrack";

/// Whether a replay's track can be played.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TrackState {
    Current,
    Stale,
}

/// One track on disk.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoredTrack {
    /// The game id the file is named after.
    pub game_id: String,
    pub state: TrackState,
    pub size_bytes: u64,
    /// When the track was last stored or watched, as milliseconds since the
    /// Unix epoch. A budget removes the lowest first.
    pub last_watched_ms: u64,
}

/// The folder tracks are kept in, given the app's data directory.
pub fn store_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("content").join(DIR)
}

/// The folder tracks are kept in for this app.
pub(crate) fn app_store_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(store_dir(&coilbox_portable::data_dir(app)?))
}

/// The path a game id's track is stored at. The id is validated first, always.
pub fn track_path(dir: &Path, game_id: &str) -> Result<PathBuf, String> {
    Ok(dir.join(format!("{}{EXTENSION}", valid_game_id(game_id)?)))
}

/// A game id as the 16 bytes a track's header holds. None for anything that is
/// not 32 hex digits.
pub(crate) fn id_bytes(game_id: &str) -> Option<[u8; 16]> {
    let mut out = [0u8; 16];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(game_id.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(out)
}

/// What the file at `path` is as a track for `game_id`: None when its header
/// names another game, and otherwise its state.
///
/// Opening the reader decodes the header, which refuses a format version this
/// build does not read, and reads the window index. No window is touched.
fn inspect(path: &Path, game_id: &str) -> Option<TrackState> {
    let opened = std::fs::File::open(path)
        .map_err(|e| e.to_string())
        .and_then(|file| {
            TrackReader::open(std::io::BufReader::new(file)).map_err(|e| e.to_string())
        });
    let Ok(reader) = opened else {
        return Some(TrackState::Stale);
    };
    let header = reader.header();
    if Some(header.game_id) != id_bytes(game_id) {
        return None;
    }
    Some(if header.recorder_version == RECORDER_VERSION {
        TrackState::Current
    } else {
        TrackState::Stale
    })
}

/// The state of a match's track, or None when there is none.
pub fn state(dir: &Path, game_id: &str) -> Result<Option<TrackState>, String> {
    let path = track_path(dir, game_id)?;
    match std::fs::metadata(&path) {
        Ok(_) => Ok(inspect(&path, game_id)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Ok(Some(TrackState::Stale)),
    }
}

/// Store a track for a match, replacing whatever was stored for it.
///
/// `write` is given a path beside the final one and writes the whole track
/// there, as `coilbox_track_thin::thin_dump` does. The file must read as a
/// current track for `game_id`, or nothing is stored and the earlier track,
/// if any, stays. Returns the size of the file stored. The temporary file is
/// removed whatever happens.
pub fn store<E: std::fmt::Display>(
    dir: &Path,
    game_id: &str,
    write: impl FnOnce(&Path) -> Result<(), E>,
) -> Result<u64, String> {
    let path = track_path(dir, game_id)?;
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    // In the same folder, so the rename cannot cross a filesystem. The name
    // does not end the way a stored file does, so a temporary file a crash
    // left behind is never read as a track.
    let temp = dir.join(format!(
        "{}{EXTENSION}.tmp-{}",
        valid_game_id(game_id)?,
        std::process::id()
    ));
    let result = (|| -> Result<u64, String> {
        write(&temp).map_err(|e| format!("could not write the track: {e}"))?;
        if inspect(&temp, game_id) != Some(TrackState::Current) {
            return Err("what was written is not a current track for this replay".into());
        }
        let file =
            std::fs::File::open(&temp).map_err(|e| format!("could not store the track: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("could not store the track: {e}"))?;
        let size = file
            .metadata()
            .map_err(|e| format!("could not store the track: {e}"))?
            .len();
        drop(file);
        std::fs::rename(&temp, &path).map_err(|e| format!("could not store the track: {e}"))?;
        Ok(size)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// Remove the temporary files that a process which died while storing a track
/// left behind, and return how many. They are named `<id>.cbtrack.tmp-<pid>`
/// and are never read as a track. A file named for this process, or for one
/// that is still running, is left: it may be a store in progress.
pub fn sweep_temporaries(dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let marker = format!("{EXTENSION}.tmp-");
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some((id, pid)) = name.split_once(&marker) else {
            continue;
        };
        let Ok(pid) = pid.parse::<u32>() else {
            continue;
        };
        if valid_game_id(id).is_ok()
            && pid != std::process::id()
            && !coilbox_proc::is_running(pid)
            && std::fs::remove_file(entry.path()).is_ok()
        {
            removed += 1;
        }
    }
    removed
}

/// Remove a match's track. Answers whether there was one.
pub fn remove(dir: &Path, game_id: &str) -> Result<bool, String> {
    match std::fs::remove_file(track_path(dir, game_id)?) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("could not remove the track: {e}")),
    }
}

/// Record that a match's track was just watched, so a budget removes it last.
/// A match with no track is left alone.
#[allow(dead_code)] // Called by #3787, which is not built yet.
pub fn mark_watched(dir: &Path, game_id: &str) -> Result<(), String> {
    let file = match std::fs::File::options()
        .write(true)
        .open(track_path(dir, game_id)?)
    {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("could not mark the track as watched: {e}")),
    };
    file.set_modified(SystemTime::now())
        .map_err(|e| format!("could not mark the track as watched: {e}"))
}

/// Every track on disk, in no particular order.
///
/// A file named after a game id is listed whatever it holds, so the space it
/// takes is counted. One whose header names another game is listed as stale.
pub fn list(dir: &Path) -> Vec<StoredTrack> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let id = name.strip_suffix(EXTENSION)?;
            // Only the lowercase form, so one id is one file.
            let id = valid_game_id(id).ok().filter(|valid| valid == id)?;
            let meta = entry.metadata().ok()?;
            Some(StoredTrack {
                state: inspect(&entry.path(), &id).unwrap_or(TrackState::Stale),
                game_id: id,
                size_bytes: meta.len(),
                last_watched_ms: meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_millis() as u64),
            })
        })
        .collect()
}

/// The stored file a replay's deletion would take with it, and its size.
///
/// None for a replay with no key, which includes a remix: deleting a remix
/// must leave its original's track alone.
pub fn stored_for_replay(dir: &Path, replay: &Path) -> Option<(String, u64)> {
    let game_id = super::analysis::store::replay_key(replay).ok()?;
    let size = std::fs::metadata(track_path(dir, &game_id).ok()?)
        .ok()?
        .len();
    Some((game_id, size))
}

/// `content_replay_tracks`: every track on disk, for the library to join to
/// its replays by game id. Each entry has its `state`, `sizeBytes` and
/// `lastWatchedMs`. The answer changes when a track is stored or removed, so
/// it is asked for and never kept in a `StatRecord`.
///
/// A remix shares its original's game id and has no track of its own, so a
/// caller joining by id leaves remixed replays out.
#[tauri::command]
pub(crate) async fn content_replay_tracks<R: Runtime>(
    app: AppHandle<R>,
) -> picoframe_core::CliResult {
    let dir = match app_store_dir(&app) {
        Ok(dir) => dir,
        Err(e) => return picoframe_core::CliResult::err(e),
    };
    match tauri::async_runtime::spawn_blocking(move || list(&dir)).await {
        Ok(tracks) => picoframe_core::CliResult::ok(serde_json::json!({ "tracks": tracks })),
        Err(e) => picoframe_core::CliResult::err(format!("replay tracks task failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use coilbox_track::{Settings, Track, FORMAT_VERSION};

    const ID: &str = "00112233445566778899aabbccddeeff";
    const OTHER: &str = "ffeeddccbbaa99887766554433221100";

    fn id_bytes(id: &str) -> [u8; 16] {
        let mut out = [0u8; 16];
        for (i, byte) in out.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&id[i * 2..i * 2 + 2], 16).unwrap();
        }
        out
    }

    /// A small whole track, as the writer makes it.
    fn track_bytes(id: &str, recorder_version: u16) -> Vec<u8> {
        let mut track = Track::new(Settings {
            recorder_version,
            game_id: id_bytes(id),
            last_frame: 90,
            ..Settings::default()
        });
        track.info.engine_version = "2025.04.08".into();
        track.to_bytes().expect("a small track writes")
    }

    fn put(dir: &Path, id: &str, bytes: &[u8]) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(track_path(dir, id).unwrap(), bytes).unwrap();
    }

    fn store_current(dir: &Path, id: &str) -> u64 {
        store(dir, id, |path| {
            std::fs::write(path, track_bytes(id, RECORDER_VERSION))
        })
        .expect("a current track stores")
    }

    #[test]
    fn the_path_is_under_the_data_dir_and_named_after_the_game_id() {
        let data = Path::new("/data");
        assert_eq!(
            track_path(&store_dir(data), ID).unwrap(),
            data.join("content")
                .join("replay-tracks")
                .join(format!("{ID}.cbtrack"))
        );
    }

    #[test]
    fn an_id_that_is_not_a_game_id_has_no_path() {
        let dir = Path::new("/data");
        for bad in ["", "../x", "00", &"0".repeat(32), &format!("{ID}/x")] {
            assert!(track_path(dir, bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn a_stored_track_is_current_and_a_missing_one_is_none() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(state(dir.path(), ID).unwrap(), None);
        let size = store_current(dir.path(), ID);
        assert_eq!(state(dir.path(), ID).unwrap(), Some(TrackState::Current));
        assert_eq!(size, track_bytes(ID, RECORDER_VERSION).len() as u64);
    }

    #[test]
    fn a_track_from_an_older_recorder_is_stale() {
        let dir = tempfile::tempdir().unwrap();
        put(dir.path(), ID, &track_bytes(ID, RECORDER_VERSION - 1));
        assert_eq!(state(dir.path(), ID).unwrap(), Some(TrackState::Stale));
    }

    #[test]
    fn a_track_from_a_newer_recorder_is_stale_too() {
        let dir = tempfile::tempdir().unwrap();
        put(dir.path(), ID, &track_bytes(ID, RECORDER_VERSION + 1));
        assert_eq!(state(dir.path(), ID).unwrap(), Some(TrackState::Stale));
    }

    #[test]
    fn a_track_in_another_format_version_is_stale() {
        let dir = tempfile::tempdir().unwrap();
        let mut bytes = track_bytes(ID, RECORDER_VERSION);
        bytes[4..6].copy_from_slice(&(FORMAT_VERSION + 1).to_le_bytes());
        put(dir.path(), ID, &bytes);
        assert_eq!(state(dir.path(), ID).unwrap(), Some(TrackState::Stale));
    }

    #[test]
    fn a_file_that_is_not_a_track_is_never_current() {
        let dir = tempfile::tempdir().unwrap();
        let whole = track_bytes(ID, RECORDER_VERSION);
        let mut wrong_magic = whole.clone();
        wrong_magic[0..4].copy_from_slice(b"NOPE");
        let cases: [(&str, Vec<u8>); 4] = [
            ("empty", vec![]),
            ("truncated header", whole[..40].to_vec()),
            ("wrong magic", wrong_magic),
            ("header but no index", whole[..96].to_vec()),
        ];
        for (name, bytes) in cases {
            put(dir.path(), ID, &bytes);
            assert_eq!(
                state(dir.path(), ID).unwrap(),
                Some(TrackState::Stale),
                "{name}"
            );
        }
    }

    #[test]
    fn a_track_whose_header_names_another_game_is_not_this_replays() {
        let dir = tempfile::tempdir().unwrap();
        put(dir.path(), ID, &track_bytes(OTHER, RECORDER_VERSION));
        assert_eq!(state(dir.path(), ID).unwrap(), None);
        // It is still on disk, and a budget has to see it.
        let listed = list(dir.path());
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].game_id, ID);
        assert_eq!(listed[0].state, TrackState::Stale);
    }

    #[test]
    fn two_replays_never_share_a_track() {
        let dir = tempfile::tempdir().unwrap();
        store_current(dir.path(), ID);
        assert_eq!(state(dir.path(), OTHER).unwrap(), None);
        store_current(dir.path(), OTHER);
        assert_ne!(
            track_path(dir.path(), ID).unwrap(),
            track_path(dir.path(), OTHER).unwrap()
        );
        assert!(remove(dir.path(), ID).unwrap());
        assert_eq!(state(dir.path(), ID).unwrap(), None);
        assert_eq!(state(dir.path(), OTHER).unwrap(), Some(TrackState::Current));
    }

    #[test]
    fn storing_replaces_the_earlier_track() {
        let dir = tempfile::tempdir().unwrap();
        put(dir.path(), ID, &track_bytes(ID, RECORDER_VERSION - 1));
        store_current(dir.path(), ID);
        assert_eq!(state(dir.path(), ID).unwrap(), Some(TrackState::Current));
    }

    #[test]
    fn a_failed_write_stores_nothing_and_leaves_no_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let err = store(dir.path(), ID, |path| {
            std::fs::write(path, b"half a track")?;
            Err::<(), _>(std::io::Error::other("the thinner failed"))
        })
        .unwrap_err();
        assert!(err.contains("the thinner failed"), "{err}");
        assert_eq!(state(dir.path(), ID).unwrap(), None);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn a_failed_write_keeps_the_track_that_was_there() {
        let dir = tempfile::tempdir().unwrap();
        store_current(dir.path(), ID);
        let _ = store(dir.path(), ID, |_| Err::<(), _>("cancelled"));
        assert_eq!(state(dir.path(), ID).unwrap(), Some(TrackState::Current));
    }

    #[test]
    fn a_write_that_is_not_a_current_track_for_the_replay_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        for (name, bytes) in [
            ("garbage", b"not a track".to_vec()),
            ("old recorder", track_bytes(ID, RECORDER_VERSION - 1)),
            ("another game", track_bytes(OTHER, RECORDER_VERSION)),
        ] {
            let result = store(dir.path(), ID, |path| std::fs::write(path, &bytes));
            assert!(result.is_err(), "{name}");
            assert_eq!(state(dir.path(), ID).unwrap(), None, "{name}");
            assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0, "{name}");
        }
    }

    #[test]
    fn a_temporary_file_from_a_crash_is_not_a_track() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(format!("{ID}.cbtrack.tmp-1")),
            track_bytes(ID, RECORDER_VERSION),
        )
        .unwrap();
        assert_eq!(state(dir.path(), ID).unwrap(), None);
        assert!(list(dir.path()).is_empty());
    }

    #[test]
    fn removing_answers_whether_there_was_a_track() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!remove(dir.path(), ID).unwrap());
        store_current(dir.path(), ID);
        assert!(remove(dir.path(), ID).unwrap());
        assert_eq!(state(dir.path(), ID).unwrap(), None);
    }

    #[test]
    fn the_list_has_every_track_with_its_size_and_last_watched_time() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list(dir.path()).is_empty());
        let a = store_current(dir.path(), ID);
        put(dir.path(), OTHER, &track_bytes(OTHER, RECORDER_VERSION - 1));
        let mut listed = list(dir.path());
        listed.sort_by(|x, y| x.game_id.cmp(&y.game_id));
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].game_id, ID);
        assert_eq!(listed[0].size_bytes, a);
        assert_eq!(listed[0].state, TrackState::Current);
        assert_eq!(listed[1].game_id, OTHER);
        assert_eq!(listed[1].state, TrackState::Stale);
        assert!(listed.iter().all(|t| t.last_watched_ms > 0));
    }

    #[test]
    fn watching_a_track_moves_its_last_watched_time_forward() {
        let dir = tempfile::tempdir().unwrap();
        store_current(dir.path(), ID);
        store_current(dir.path(), OTHER);
        // Put both a day in the past, then watch one.
        let past = SystemTime::now() - std::time::Duration::from_secs(86_400);
        for id in [ID, OTHER] {
            std::fs::File::options()
                .write(true)
                .open(track_path(dir.path(), id).unwrap())
                .unwrap()
                .set_modified(past)
                .unwrap();
        }
        mark_watched(dir.path(), ID).unwrap();
        let at = |id: &str| {
            list(dir.path())
                .into_iter()
                .find(|t| t.game_id == id)
                .unwrap()
                .last_watched_ms
        };
        assert!(at(ID) > at(OTHER));
    }

    #[test]
    fn watching_a_match_with_no_track_does_nothing() {
        let dir = tempfile::tempdir().unwrap();
        mark_watched(dir.path(), ID).unwrap();
        assert!(list(dir.path()).is_empty());
    }

    #[test]
    fn a_missing_folder_lists_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list(&dir.path().join("nope")).is_empty());
    }

    #[test]
    fn a_file_in_the_folder_that_is_not_named_after_an_id_is_left_out() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("notes.cbtrack"), b"x").unwrap();
        std::fs::write(dir.path().join("readme.txt"), b"x").unwrap();
        assert!(list(dir.path()).is_empty());
    }

    // ---- a replay and its track ---------------------------------------------

    const SCRIPT: &str = "[game]\n{\ngametype=Some Game 1.0;\nmapname=Some Map;\n}\n";

    /// The game id `DemoFixture` writes by default, as hex.
    fn fixture_id() -> String {
        super::super::tests::DemoFixture::default()
            .game_id
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    fn replay(game_id: [u8; 16]) -> Vec<u8> {
        super::super::tests::DemoFixture {
            script: SCRIPT.into(),
            stream: super::super::retarget::tests::stream_with_game_data(SCRIPT, &[]),
            game_id,
            ..Default::default()
        }
        .gzipped()
    }

    fn fixture_replay(path: &Path) {
        std::fs::write(
            path,
            replay(super::super::tests::DemoFixture::default().game_id),
        )
        .unwrap();
    }

    #[test]
    fn renaming_a_replay_keeps_its_track() {
        let dir = tempfile::tempdir().unwrap();
        let tracks = dir.path().join("tracks");
        let id = fixture_id();
        let before = dir.path().join("before.sdfz");
        fixture_replay(&before);
        let size = store_current(&tracks, &id);
        assert_eq!(
            stored_for_replay(&tracks, &before),
            Some((id.clone(), size))
        );

        let after = dir.path().join("somewhere else.sdfz");
        std::fs::rename(&before, &after).unwrap();

        assert_eq!(stored_for_replay(&tracks, &after), Some((id.clone(), size)));
        assert_eq!(state(&tracks, &id).unwrap(), Some(TrackState::Current));
    }

    #[test]
    fn a_replay_with_no_game_id_has_no_track() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("match.sdfz");
        std::fs::write(&path, replay([0; 16])).unwrap();
        assert_eq!(stored_for_replay(dir.path(), &path), None);
    }

    #[test]
    fn deleting_a_replay_lists_its_track_in_the_preview_and_removes_it_when_applied() {
        let dir = tempfile::tempdir().unwrap();
        let tracks = dir.path().join("tracks");
        let id = fixture_id();
        let with_track = dir.path().join("with.sdfz");
        let without = dir.path().join("without.sdfz");
        fixture_replay(&with_track);
        std::fs::write(&without, replay([7; 16])).unwrap();
        let size = store_current(&tracks, &id);
        let paths = [with_track.clone(), without.clone()];
        let delete = super::super::delete_replays;

        let preview = delete(&paths, false, None, Some(&tracks), &[]);
        assert_eq!((preview.deleted, preview.tracks), (2, 1));
        assert_eq!(preview.track_bytes, size);
        assert!(with_track.is_file());
        assert_eq!(state(&tracks, &id).unwrap(), Some(TrackState::Current));

        let applied = delete(&paths, true, None, Some(&tracks), &[]);
        assert_eq!((applied.deleted, applied.tracks), (2, 1));
        assert_eq!(applied.track_bytes, size);
        assert!(applied.skipped.is_empty(), "{:?}", applied.skipped);
        assert!(!with_track.exists() && !without.exists());
        assert_eq!(state(&tracks, &id).unwrap(), None);
    }

    #[test]
    fn deleting_a_replay_with_no_track_reports_none_and_touches_nothing_else() {
        let dir = tempfile::tempdir().unwrap();
        let tracks = dir.path().join("tracks");
        let path = dir.path().join("plain.sdfz");
        fixture_replay(&path);
        let other = "07".repeat(16);
        store_current(&tracks, &other);

        let applied = super::super::delete_replays(
            std::slice::from_ref(&path),
            true,
            None,
            Some(&tracks),
            &[],
        );

        assert_eq!(
            (applied.deleted, applied.tracks, applied.track_bytes),
            (1, 0, 0)
        );
        assert_eq!(state(&tracks, &other).unwrap(), Some(TrackState::Current));
    }

    #[test]
    fn deleting_without_a_track_folder_deletes_the_replay_as_before() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plain.sdfz");
        fixture_replay(&path);
        let applied =
            super::super::delete_replays(std::slice::from_ref(&path), true, None, None, &[]);
        assert_eq!((applied.deleted, applied.tracks), (1, 0));
        assert!(!path.exists());
    }

    #[test]
    fn a_track_goes_with_the_last_copy_of_its_match() {
        let dir = tempfile::tempdir().unwrap();
        let tracks = dir.path().join("tracks");
        let root = dir.path().join("root");
        std::fs::create_dir_all(root.join("demos")).unwrap();
        let first = root.join("demos").join("a.sdfz");
        let second = root.join("demos").join("b.sdfz");
        fixture_replay(&first);
        fixture_replay(&second);
        let id = fixture_id();
        store_current(&tracks, &id);
        let library = || -> Vec<(PathBuf, String)> {
            super::super::list_replays_stored(&root, None)
                .0
                .into_iter()
                .filter_map(|r| {
                    let path = PathBuf::from(&r.path);
                    Some((std::fs::canonicalize(path).ok()?, r.game_id?))
                })
                .collect()
        };
        let delete = super::super::delete_replays;

        let applied = delete(
            std::slice::from_ref(&first),
            true,
            None,
            Some(&tracks),
            &library(),
        );
        assert_eq!((applied.deleted, applied.tracks), (1, 0));
        assert_eq!(state(&tracks, &id).unwrap(), Some(TrackState::Current));

        let applied = delete(
            std::slice::from_ref(&second),
            true,
            None,
            Some(&tracks),
            &library(),
        );
        assert_eq!((applied.deleted, applied.tracks), (1, 1));
        assert_eq!(state(&tracks, &id).unwrap(), None);
    }

    /// The remix and the original hold the same id. Deleting the remix must
    /// not take the original's track.
    #[test]
    fn deleting_a_remix_leaves_its_originals_track() {
        let dir = tempfile::tempdir().unwrap();
        let tracks = dir.path().join("tracks");
        let original = dir.path().join("match.sdfz");
        fixture_replay(&original);
        let remix = super::super::rewrite_demo(&original, "Other Game 2.0", None).unwrap();
        let id = fixture_id();
        store_current(&tracks, &id);

        let applied = super::super::delete_replays(
            std::slice::from_ref(&remix),
            true,
            None,
            Some(&tracks),
            &[],
        );

        assert_eq!((applied.deleted, applied.tracks), (1, 0));
        assert_eq!(state(&tracks, &id).unwrap(), Some(TrackState::Current));
    }

    /// The list is read from the files each time, so a track deleted outside
    /// the app is gone from the answer and nothing is left to clear.
    #[test]
    fn a_track_deleted_outside_the_app_is_gone_from_the_list() {
        let dir = tempfile::tempdir().unwrap();
        store_current(dir.path(), ID);
        assert_eq!(list(dir.path()).len(), 1);
        std::fs::remove_file(track_path(dir.path(), ID).unwrap()).unwrap();
        assert!(list(dir.path()).is_empty());
        assert_eq!(state(dir.path(), ID).unwrap(), None);
    }

    /// A crash while storing leaves `<id>.cbtrack.tmp-<pid>`, and nothing else
    /// reads or removes it.
    #[test]
    fn a_temporary_file_left_by_a_dead_process_is_swept_and_nothing_else_is() {
        let dir = tempfile::tempdir().unwrap();
        let mut gone = coilbox_proc::command(std::env::current_exe().unwrap())
            .arg("--list")
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let dead = gone.id();
        gone.wait().unwrap();
        let ours = std::process::id();
        store_current(dir.path(), ID);
        let temporary = |id: &str, pid: u32| format!("{id}{EXTENSION}.tmp-{pid}");
        let kept = [
            format!("{ID}{EXTENSION}"),
            temporary(ID, ours),
            temporary("not-an-id", dead),
            format!("{ID}{EXTENSION}.tmp-soon"),
        ];
        for name in kept.iter().skip(1) {
            std::fs::write(dir.path().join(name), b"half a track").unwrap();
        }
        std::fs::write(dir.path().join(temporary(OTHER, dead)), b"half a track").unwrap();

        assert_eq!(sweep_temporaries(dir.path()), 1);

        let mut left: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        let mut expected = kept.to_vec();
        expected.sort();
        assert_eq!(left, expected);
        assert_eq!(sweep_temporaries(&dir.path().join("missing")), 0);
    }
}
