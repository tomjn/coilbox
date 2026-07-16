//! Best-effort durable DM history: one append-only JSONL file per account, keyed
//! by a sanitized `serverKey`. Only the connection task touches an instance, so no
//! internal locking is needed. All IO is best-effort - a failure is logged and
//! never breaks live chat.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use coilbox_lobby_protocol::ChatMsg;
use serde::{Deserialize, Serialize};

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
        let dir = std::env::temp_dir().join(format!("coilbox-dmlog-test-{}", std::process::id()));
        let log = DmLog::new(&dir, "me@host:8200");
        log.append("bob", &msg("me", "hi bob", 1));
        log.append("bob", &msg("bob", "hi me", 2));
        log.append("carol", &msg("carol", "yo", 3));

        let loaded = log.load();
        assert_eq!(loaded["bob"].len(), 2);
        assert_eq!(loaded["bob"][0].text, "hi bob");
        assert_eq!(loaded["bob"][1].from, "bob");
        assert_eq!(loaded["carol"].len(), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Lines written before `ChatMsg` grew an `id` have no such field. Bad lines
    /// are skipped silently, so without a serde default this wouldn't fail loudly
    /// - it would just quietly discard every existing user's DM history.
    #[test]
    fn loads_lines_written_before_the_id_field_existed() {
        let dir = std::env::temp_dir().join(format!("coilbox-dmlog-legacy-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("temp dir");
        let key = "me@host:8200";
        fs::write(
            dir.join(format!("{}.jsonl", sanitize_key(key))),
            "{\"peer\":\"bob\",\"msg\":{\"channel\":null,\"from\":\"bob\",\"text\":\"from before\",\"kind\":\"private\",\"at\":1}}\n",
        )
        .expect("seed legacy log");

        let loaded = DmLog::new(&dir, key).load();
        assert_eq!(loaded["bob"].len(), 1, "legacy line must still load");
        assert_eq!(loaded["bob"][0].text, "from before");
        assert_eq!(loaded["bob"][0].id, None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_file_loads_empty() {
        let dir =
            std::env::temp_dir().join(format!("coilbox-dmlog-missing-{}", std::process::id()));
        let log = DmLog::new(&dir, "nobody@nowhere:1");
        assert!(log.load().is_empty());
    }
}
