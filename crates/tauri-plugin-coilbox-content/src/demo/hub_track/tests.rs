use std::io::{Read as _, Write as _};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

use coilbox_track::{Settings, Track, FORMAT_VERSION};
use serde_json::{json, Value};

use super::*;

const ID: &str = "00112233445566778899aabbccddeeff";
const OTHER: &str = "ffeeddccbbaa99887766554433221100";
const BUDGET: u64 = track_budget::DEFAULT_BUDGET_BYTES;

fn track_bytes(id: &str, recorder_version: u16) -> Vec<u8> {
    Track::new(Settings {
        recorder_version,
        game_id: track_store::id_bytes(id).unwrap(),
        last_frame: 90,
        ..Settings::default()
    })
    .to_bytes()
    .expect("a small track writes")
}

fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The entry a hub would list for `file`, fetched from `{base}/file`.
fn entry(base: &str, file: &[u8]) -> Value {
    json!({
        "game_id": ID,
        "format_version": FORMAT_VERSION,
        "state": "listed",
        "recorder_version": RECORDER_VERSION,
        "size": file.len(),
        "sha256": sha(file),
        "url": format!("{base}/file"),
    })
}

/// A hub and its mirror on one loopback port. `list` answers the tracks route
/// and `file` is what `/file` serves. Every path asked for is kept.
struct Hub {
    base: String,
    asked: Arc<Mutex<Vec<String>>>,
}

fn serve(list: impl FnOnce(&str) -> (u16, Value), file: Vec<u8>) -> Hub {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (status, body) = list(&base);
    let asked = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&asked);
    std::thread::spawn(move || {
        for socket in listener.incoming() {
            let Ok(mut socket) = socket else { return };
            // The request is read first: closing a socket with it unread
            // resets the connection and the client loses the answer.
            let mut request = Vec::new();
            let mut chunk = [0u8; 1024];
            while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                match socket.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => request.extend_from_slice(&chunk[..n]),
                }
            }
            let text = String::from_utf8_lossy(&request);
            let Some(path) = text.split_whitespace().nth(1) else {
                continue;
            };
            let (status, bytes) = if path == "/file" {
                (200, file.clone())
            } else if path == format!("/api/v1/replays/{ID}/tracks") {
                (status, body.to_string().into_bytes())
            } else {
                (500, Vec::new())
            };
            seen.lock().unwrap().push(path.to_owned());
            let head = format!(
                "HTTP/1.1 {status} X\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                bytes.len()
            );
            let _ = socket.write_all(head.as_bytes());
            let _ = socket.write_all(&bytes);
        }
    });
    Hub { base, asked }
}

/// A hub listing exactly the file it serves, with one field changed.
fn serve_changed(file: Vec<u8>, key: &'static str, value: Value) -> Hub {
    let listed = file.clone();
    serve(
        move |base| {
            let mut track = entry(base, &listed);
            track[key] = value;
            (200, json!({ "tracks": [track] }))
        },
        file,
    )
}

fn serve_file(file: Vec<u8>) -> Hub {
    serve_changed(file, "state", json!("listed"))
}

fn run<T>(work: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(work)
}

fn get(hub: &Hub, dir: &Path) -> Result<Downloaded, String> {
    run(download(&hub.base, dir, ID, BUDGET))
}

fn code(said: &str) -> String {
    UiError::parse(said)
        .unwrap_or_else(|| panic!("not a UiError: {said}"))
        .code
        .into_owned()
}

fn stored(dir: &Path) -> Option<Vec<u8>> {
    std::fs::read(track_store::track_path(dir, ID).unwrap()).ok()
}

fn files(dir: &Path) -> usize {
    std::fs::read_dir(dir).map_or(0, |entries| entries.count())
}

#[test]
fn a_track_that_matches_the_hubs_size_and_hash_is_stored() {
    let file = track_bytes(ID, RECORDER_VERSION);
    let hub = serve_file(file.clone());
    let dir = tempfile::tempdir().unwrap();

    let found = run(find(&hub.base, ID)).unwrap().unwrap();
    assert_eq!(found.size, file.len() as u64);
    assert_eq!(get(&hub, dir.path()).unwrap(), Downloaded::Stored);

    assert_eq!(stored(dir.path()), Some(file));
    assert_eq!(
        track_store::state(dir.path(), ID).unwrap(),
        Some(TrackState::Current)
    );
    assert_eq!(files(dir.path()), 1);
}

#[test]
fn a_file_with_another_hash_or_size_is_thrown_away() {
    let file = track_bytes(ID, RECORDER_VERSION);
    let size = file.len() as u64;
    for (case, key, value) in [
        ("another hash", "sha256", json!("0".repeat(64))),
        ("longer than listed", "size", json!(size - 1)),
        ("shorter than listed", "size", json!(size + 1)),
    ] {
        let hub = serve_changed(file.clone(), key, value);
        let dir = tempfile::tempdir().unwrap();

        let said = get(&hub, dir.path()).unwrap_err();

        assert_eq!(code(&said), MISMATCH, "{case}");
        assert_eq!(files(dir.path()), 0, "{case}");
    }
}

#[test]
fn a_file_that_is_not_a_current_track_of_this_match_is_not_kept() {
    for (case, file) in [
        ("another match", track_bytes(OTHER, RECORDER_VERSION)),
        ("old recorder", track_bytes(ID, RECORDER_VERSION - 1)),
        ("not a track", b"not a track".to_vec()),
    ] {
        // The hub's list says nothing is wrong with it.
        let hub = serve_file(file);
        let dir = tempfile::tempdir().unwrap();
        let earlier = track_bytes(ID, RECORDER_VERSION - 1);
        std::fs::write(track_store::track_path(dir.path(), ID).unwrap(), &earlier).unwrap();

        let said = get(&hub, dir.path()).unwrap_err();

        assert_eq!(code(&said), NOT_PLAYABLE, "{case}");
        assert_eq!(stored(dir.path()), Some(earlier), "{case}");
        assert_eq!(files(dir.path()), 1, "{case}");
    }
}

#[test]
fn a_track_this_build_cannot_play_or_fetch_is_not_offered() {
    let file = track_bytes(ID, RECORDER_VERSION);
    for (case, key, value) in [
        (
            "older recorder",
            "recorder_version",
            json!(RECORDER_VERSION - 1),
        ),
        (
            "newer recorder",
            "recorder_version",
            json!(RECORDER_VERSION + 1),
        ),
        ("recorder unread", "recorder_version", Value::Null),
        (
            "another format",
            "format_version",
            json!(FORMAT_VERSION + 1),
        ),
        ("being checked", "state", json!("checking")),
        ("no address", "url", Value::Null),
    ] {
        let hub = serve_changed(file.clone(), key, value);
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(run(find(&hub.base, ID)).unwrap(), None, "{case}");
        assert_eq!(get(&hub, dir.path()).unwrap(), Downloaded::Unavailable);
        assert!(
            !hub.asked.lock().unwrap().contains(&"/file".into()),
            "{case}"
        );
        assert_eq!(files(dir.path()), 0, "{case}");
    }
}

#[test]
fn a_playable_track_is_found_after_one_that_is_not() {
    let file = track_bytes(ID, RECORDER_VERSION);
    let listed = file.clone();
    let hub = serve(
        move |base| {
            let mut newer = entry(base, &listed);
            newer["format_version"] = json!(FORMAT_VERSION + 1);
            (200, json!({ "tracks": [newer, entry(base, &listed)] }))
        },
        file,
    );

    assert!(run(find(&hub.base, ID)).unwrap().is_some());
}

#[test]
fn an_unlisted_replay_and_an_empty_list_are_no_track() {
    for answer in [
        (404, json!({ "reason": "not_listed" })),
        (200, json!({ "tracks": [] })),
    ] {
        let hub = serve(|_| answer.clone(), Vec::new());
        assert_eq!(run(find(&hub.base, ID)).unwrap(), None, "{answer:?}");
    }
}

#[test]
fn any_other_answer_is_an_error_and_not_no_track() {
    for answer in [
        (404, json!({ "message": "no such page" })),
        (500, json!({ "reason": "not_listed" })),
        (200, json!({ "something": "else" })),
    ] {
        let hub = serve(|_| answer.clone(), Vec::new());
        let said = run(find(&hub.base, ID)).unwrap_err();
        assert_eq!(code(&said), BAD_ANSWER, "{answer:?}");
    }
}

#[test]
fn a_match_with_a_current_track_keeps_it_and_the_hub_is_not_asked() {
    let hub = serve_file(track_bytes(ID, RECORDER_VERSION));
    let dir = tempfile::tempdir().unwrap();
    let own = track_bytes(ID, RECORDER_VERSION);
    std::fs::write(track_store::track_path(dir.path(), ID).unwrap(), &own).unwrap();

    assert_eq!(get(&hub, dir.path()).unwrap(), Downloaded::Stored);

    assert!(hub.asked.lock().unwrap().is_empty());
}

#[test]
fn a_downloaded_track_counts_against_the_disk_budget() {
    let file = track_bytes(ID, RECORDER_VERSION);
    let hub = serve_file(file.clone());
    let dir = tempfile::tempdir().unwrap();
    let other = track_store::track_path(dir.path(), OTHER).unwrap();
    std::fs::write(&other, track_bytes(OTHER, RECORDER_VERSION)).unwrap();

    run(download(&hub.base, dir.path(), ID, file.len() as u64)).unwrap();

    assert!(!other.exists(), "the older track made room");
    assert_eq!(stored(dir.path()), Some(file));
}
