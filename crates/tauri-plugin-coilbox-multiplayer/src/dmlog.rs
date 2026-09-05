//! Best-effort durable DM history: one append-only JSONL file per account, keyed
//! by a sanitized `serverKey`. Only the connection task touches an instance, so no
//! internal locking is needed. All IO is best-effort - a failure is logged and
//! never breaks live chat.

use std::collections::{BTreeMap, HashMap};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use coilbox_lobby_protocol::ChatMsg;
use picoframe_core::CliResult;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Runtime;

/// One persisted DM line: the thread key (`peer`) plus the message.
#[derive(Serialize, Deserialize)]
struct StoredDm {
    peer: String,
    msg: ChatMsg,
}

/// Append-only DM history at a fixed path.
pub struct DmLog {
    path: PathBuf,
}

/// Turn a `serverKey` (`user@host:port`) into a filesystem-safe stem.
pub fn sanitize_key(server_key: &str) -> String {
    server_key
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// The log file stems (already-sanitized server keys) present in `dir`. The stem
/// is a valid `server_key` for [`DmLog::new`] (sanitizing it again is a no-op), so
/// the viewer can reopen a log without knowing the original `user@host:port`.
pub fn account_stems(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) == Some("jsonl") {
                if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                    out.push(stem.to_string());
                }
            }
        }
    }
    out
}

impl DmLog {
    /// A log at `<dir>/<sanitized key>.jsonl`. Does not touch disk yet.
    pub fn new(dir: &Path, server_key: &str) -> Self {
        DmLog {
            path: dir.join(format!("{}.jsonl", sanitize_key(server_key))),
        }
    }

    /// Load all threads grouped by peer. Missing file -> empty; bad lines skipped.
    pub fn load(&self) -> HashMap<String, Vec<ChatMsg>> {
        let mut out: HashMap<String, Vec<ChatMsg>> = HashMap::new();
        let Ok(contents) = fs::read_to_string(&self.path) else {
            return out;
        };
        for line in contents.lines() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(rec) = serde_json::from_str::<StoredDm>(line) {
                out.entry(rec.peer).or_default().push(rec.msg);
            }
        }
        out
    }

    /// Per-thread summary: `(thread key, message count, latest timestamp)`, so the
    /// log viewer can list conversations without shipping every message.
    pub fn summaries(&self) -> Vec<(String, u32, u64)> {
        self.load()
            .into_iter()
            .map(|(k, v)| {
                let last = v.iter().map(|m| m.at).max().unwrap_or(0);
                (k, v.len() as u32, last)
            })
            .collect()
    }

    /// One thread's messages in order (empty if the thread/file is absent).
    pub fn thread(&self, name: &str) -> Vec<ChatMsg> {
        self.load().remove(name).unwrap_or_default()
    }

    /// Append one message to `peer`'s thread. Best-effort; logs on failure.
    pub fn append(&self, peer: &str, msg: &ChatMsg) {
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let rec = StoredDm {
            peer: peer.to_string(),
            msg: msg.clone(),
        };
        let line = match serde_json::to_string(&rec) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("dmlog: serialize failed: {e}");
                return;
            }
        };
        match OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
        {
            Ok(mut f) => {
                if let Err(e) = writeln!(f, "{line}") {
                    eprintln!("dmlog: write failed: {e}");
                }
            }
            Err(e) => eprintln!("dmlog: open failed: {e}"),
        }
    }
}

/// `mp_chat_logs`: enumerate saved chat logs (DM + channel threads) across every
/// account, for the log viewer. Reads the log dirs directly, so it works with no
/// active connection. Each account's threads are newest-activity first.
#[tauri::command]
pub(crate) fn mp_chat_logs<R: Runtime>(app: tauri::AppHandle<R>) -> CliResult {
    let (dm_dir, chan_dir) = match crate::log_dirs(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let mut accounts: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for (dir, kind) in [(&dm_dir, "dm"), (&chan_dir, "channel")] {
        for stem in account_stems(dir) {
            let log = DmLog::new(dir, &stem);
            for (name, count, last_at) in log.summaries() {
                accounts.entry(stem.clone()).or_default().push(json!({
                    "kind": kind,
                    "name": name,
                    "messageCount": count,
                    "lastAt": last_at,
                }));
            }
        }
    }
    let out: Vec<Value> = accounts
        .into_iter()
        .map(|(account, mut threads)| {
            threads.sort_by(|a, b| b["lastAt"].as_u64().cmp(&a["lastAt"].as_u64()));
            json!({ "account": account, "threads": threads })
        })
        .collect();
    CliResult::ok(json!({ "accounts": out }))
}

/// `mp_chat_log_open`: load one saved thread's messages (a DM peer or a channel)
/// for `account` (a log file stem from `mp_chat_logs`). `kind` selects the store.
#[tauri::command]
pub(crate) fn mp_chat_log_open<R: Runtime>(
    app: tauri::AppHandle<R>,
    account: String,
    kind: String,
    name: String,
) -> CliResult {
    let (dm_dir, chan_dir) = match crate::log_dirs(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let dir = if kind == "channel" { chan_dir } else { dm_dir };
    let log = DmLog::new(&dir, &account);
    CliResult::ok(json!({ "messages": log.thread(&name) }))
}

/// Somewhere for a test to keep conversation logs that is not the developer's own
/// store, and that no other run can reach.
///
/// Every fixture in this crate that drives a real connection has to hand
/// [`crate::conn::spawn_connection`] a real [`DmLog`], because the connection task
/// seeds `state.dms` from one and writes chat to it. They used to build that log
/// under a fixed directory in the system temp directory, named after the
/// connection key. The key carries the loopback port the stand-in server was
/// handed, the OS hands the same ephemeral port out again on a later run, and
/// nothing deleted the file, so a run could open a log an earlier run had left
/// behind and start with that run's messages already in state. That is #2093,
/// found after 5 failures in 300 runs, and #2107 for the five fixtures with the
/// same shape that had not yet asserted on anything that would show it.
///
/// A random directory per client rather than a delete-afterwards step: the name
/// cannot collide with an earlier run even if the connection task writes one more
/// line after the test has finished with it. Hold this for as long as the
/// connection lives, so the directory goes when the fixture does.
#[cfg(test)]
pub(crate) struct ScratchLogs {
    dir: tempfile::TempDir,
}

#[cfg(test)]
impl ScratchLogs {
    pub(crate) fn new() -> Self {
        ScratchLogs {
            dir: tempfile::tempdir().expect("a scratch directory for the conversation logs"),
        }
    }

    /// The direct-message log for `server_key`.
    pub(crate) fn dms(&self, server_key: &str) -> DmLog {
        DmLog::new(&self.dir.path().join("lobby-dms"), server_key)
    }

    /// The channel log for `server_key`. A separate directory from [`Self::dms`],
    /// the way [`crate::log_dirs`] keeps them, so battle chat is not written into
    /// the file the direct-message loader reads back.
    pub(crate) fn channels(&self, server_key: &str) -> DmLog {
        DmLog::new(&self.dir.path().join("lobby-channels"), server_key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use coilbox_lobby_protocol::ChatKind;

    fn msg(from: &str, text: &str, at: u64) -> ChatMsg {
        ChatMsg {
            channel: None,
            from: from.to_string(),
            text: text.to_string(),
            kind: ChatKind::Private,
            at,
            id: None,
        }
    }

    #[test]
    fn round_trips_grouped_by_peer_in_order() {
        let dir = tempfile::tempdir().expect("a scratch directory");
        let log = DmLog::new(dir.path(), "me@host:8200");
        log.append("bob", &msg("me", "hi bob", 1));
        log.append("bob", &msg("bob", "hi me", 2));
        log.append("carol", &msg("carol", "yo", 3));

        let loaded = log.load();
        assert_eq!(loaded["bob"].len(), 2);
        assert_eq!(loaded["bob"][0].text, "hi bob");
        assert_eq!(loaded["bob"][1].from, "bob");
        assert_eq!(loaded["carol"].len(), 1);
    }

    /// Lines written before `ChatMsg` grew an `id` have no such field. Bad lines
    /// are skipped silently, so without a serde default this wouldn't fail loudly
    /// - it would just quietly discard every existing user's DM history.
    #[test]
    fn loads_lines_written_before_the_id_field_existed() {
        let dir = tempfile::tempdir().expect("a scratch directory");
        let key = "me@host:8200";
        fs::write(
            dir.path().join(format!("{}.jsonl", sanitize_key(key))),
            "{\"peer\":\"bob\",\"msg\":{\"channel\":null,\"from\":\"bob\",\"text\":\"from before\",\"kind\":\"private\",\"at\":1}}\n",
        )
        .expect("seed legacy log");

        let loaded = DmLog::new(dir.path(), key).load();
        assert_eq!(loaded["bob"].len(), 1, "legacy line must still load");
        assert_eq!(loaded["bob"][0].text, "from before");
        assert_eq!(loaded["bob"][0].id, None);
    }

    #[test]
    fn missing_file_loads_empty() {
        let dir =
            std::env::temp_dir().join(format!("coilbox-dmlog-missing-{}", std::process::id()));
        let log = DmLog::new(&dir, "nobody@nowhere:1");
        assert!(log.load().is_empty());
    }
}
