//! What recordings have cost on this machine (issue #3788), so the replay page
//! can estimate what the next one will.
//!
//! One entry per match, in a single file beside the tracks folder. Recording a
//! match again replaces its entry, so the file holds at most one entry for
//! each match that has been recorded. An entry is the match's length in
//! frames, how long the whole job took and how big the track came out. The
//! time runs from the job starting to the track being stored, so it includes
//! the thinning, and it is whatever this build measured.
//!
//! The file is only history. Losing it costs the estimate and nothing else.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The file's name, beside the tracks folder.
const FILE: &str = "replay-recording-costs.json";

/// What one recording cost.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Cost {
    /// The match it was of. A second recording of it replaces this entry.
    pub game_id: String,
    /// The game the replay was recorded on, as the replay names it.
    pub game: String,
    /// The match's length in frames.
    pub frames: u64,
    /// From the job starting to the track being stored, in milliseconds.
    pub millis: u64,
    /// The track's size on disk in bytes.
    pub track_bytes: u64,
}

/// Where the entries for the tracks in `tracks` are kept.
pub fn file_for(tracks: &Path) -> PathBuf {
    tracks.with_file_name(FILE)
}

/// Every entry. Empty when there is no file or it does not read.
pub fn list(tracks: &Path) -> Vec<Cost> {
    std::fs::read_to_string(file_for(tracks))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Keep `cost`, in place of any earlier entry for the same match.
pub fn record(tracks: &Path, cost: Cost) -> Result<(), String> {
    let mut all = list(tracks);
    all.retain(|earlier| earlier.game_id != cost.game_id);
    all.push(cost);
    let path = file_for(tracks);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not make the folder for recording costs: {e}"))?;
    }
    let text = serde_json::to_string(&all).map_err(|e| e.to_string())?;
    // Whole or absent: written beside the file and renamed over it.
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, text)
        .and_then(|()| std::fs::rename(&temporary, &path))
        .map_err(|e| format!("could not keep what the recording cost: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cost(id: &str, game: &str, frames: u64, millis: u64, bytes: u64) -> Cost {
        Cost {
            game_id: id.into(),
            game: game.into(),
            frames,
            millis,
            track_bytes: bytes,
        }
    }

    #[test]
    fn with_no_file_there_are_no_entries() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(list(&dir.path().join("tracks")), Vec::new());
    }

    #[test]
    fn an_entry_is_kept_and_read_back() {
        let dir = tempfile::tempdir().unwrap();
        let tracks = dir.path().join("tracks");
        let a = cost("aa", "Some Game 1", 900, 4000, 120);
        let b = cost("bb", "Other Game 2", 300, 1000, 40);

        record(&tracks, a.clone()).unwrap();
        record(&tracks, b.clone()).unwrap();

        assert_eq!(list(&tracks), vec![a, b]);
    }

    #[test]
    fn recording_a_match_again_replaces_its_entry() {
        let dir = tempfile::tempdir().unwrap();
        let tracks = dir.path().join("tracks");
        record(&tracks, cost("aa", "Some Game 1", 900, 4000, 120)).unwrap();
        record(&tracks, cost("bb", "Some Game 1", 300, 1000, 40)).unwrap();
        let again = cost("aa", "Some Game 1", 900, 3000, 110);

        record(&tracks, again.clone()).unwrap();

        let all = list(&tracks);
        assert_eq!(all.len(), 2);
        assert!(all.contains(&again));
    }

    #[test]
    fn a_file_that_does_not_read_is_no_entries_and_is_written_over() {
        let dir = tempfile::tempdir().unwrap();
        let tracks = dir.path().join("tracks");
        std::fs::write(file_for(&tracks), b"not json").unwrap();
        assert_eq!(list(&tracks), Vec::new());

        let one = cost("aa", "Some Game 1", 900, 4000, 120);
        record(&tracks, one.clone()).unwrap();

        assert_eq!(list(&tracks), vec![one]);
    }

    #[test]
    fn the_file_sits_beside_the_tracks_folder_and_not_in_it() {
        let dir = tempfile::tempdir().unwrap();
        let tracks = dir.path().join("tracks");
        std::fs::create_dir_all(&tracks).unwrap();

        record(&tracks, cost("aa", "Some Game 1", 900, 4000, 120)).unwrap();

        assert_eq!(std::fs::read_dir(&tracks).unwrap().count(), 0);
        assert!(file_for(&tracks).is_file());
    }
}
